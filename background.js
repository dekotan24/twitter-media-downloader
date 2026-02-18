// X Multi Video Downloader - Background Script
// Intercepts GraphQL API responses to extract media data and handles download requests

// --- Utility: format tweet created_at to YYYYMMDD_HHMMSS ---

function formatTweetDate(createdAt) {
  if (!createdAt) return '';
  try {
    const d = new Date(createdAt);
    if (isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  } catch (_) {
    return '';
  }
}

// --- Media extraction from GraphQL responses ---

function findMediaInObject(obj, seen = new WeakSet()) {
  const results = [];
  if (!obj || typeof obj !== 'object') return results;
  if (seen.has(obj)) return results;
  seen.add(obj);

  // Check if this object is a tweet result with media
  const legacy = obj.legacy || obj.tweet?.legacy;
  const core = obj.core || obj.tweet?.core;
  if (legacy?.extended_entities?.media && core?.user_results?.result?.legacy?.screen_name) {
    const screenName = core.user_results.result.legacy.screen_name;
    const tweetId = legacy.id_str;
    const mediaArr = legacy.extended_entities.media;
    const dateStr = formatTweetDate(legacy.created_at);
    const datePart = dateStr ? `-${dateStr}` : '';

    // Check if parent tweet references this as a quote
    let referencedBy = obj._referencedBy || null;

    for (let i = 0; i < mediaArr.length; i++) {
      const media = mediaArr[i];
      const readableFilename = mediaArr.length === 1
        ? `${screenName}-${tweetId}${datePart}`
        : `${screenName}-${tweetId}${datePart}-${i + 1}`;

      if (media.type === 'video' || media.type === 'animated_gif') {
        const variants = media.video_info?.variants || [];
        const mp4Variants = variants
          .filter(v => v.content_type === 'video/mp4')
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        if (mp4Variants.length > 0) {
          results.push({
            type: media.type === 'video' ? 'video' : 'gif',
            url: mp4Variants[0].url,
            readableFilename,
            tweetId,
            referencedBy,
          });
        }
      } else if (media.type === 'photo') {
        let url = media.media_url_https;
        if (url) {
          try {
            const u = new URL(url);
            u.searchParams.set('name', 'orig');
            url = u.toString();
          } catch (_) {}
        }
        results.push({
          type: 'image',
          url,
          readableFilename,
          tweetId,
          referencedBy,
        });
      }
    }
  }

  // Mark quoted tweets so we know which parent references them
  if (obj.quoted_status_result?.result) {
    const parentId = legacy?.id_str;
    if (parentId) {
      obj.quoted_status_result.result._referencedBy = parentId;
    }
  }

  // Recurse into all child objects/arrays
  const entries = Array.isArray(obj) ? obj.entries() : Object.entries(obj);
  for (const [, value] of entries) {
    if (value && typeof value === 'object') {
      results.push(...findMediaInObject(value, seen));
    }
  }

  return results;
}

function deduplicateMedia(medias) {
  const seen = new Set();
  return medias.filter(m => {
    const key = `${m.tweetId}:${m.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// --- WebRequest interception ---

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId === -1) return;

    const filter = browser.webRequest.filterResponseData(details.requestId);
    const chunks = [];

    filter.ondata = (event) => {
      chunks.push(event.data);
      filter.write(event.data);
    };

    filter.onstop = async () => {
      try {
        const responseText = await new Blob(chunks).text();
        const json = JSON.parse(responseText);
        const medias = deduplicateMedia(findMediaInObject(json));

        if (medias.length > 0) {
          browser.tabs.sendMessage(details.tabId, {
            type: 'UPDATE_MEDIA_DATA',
            data: medias,
          }).catch(() => {});
        }
      } catch (e) {
        // JSON parse error or other - ignore silently
      } finally {
        try { filter.close(); }
        catch (_) { filter.disconnect(); }
      }
    };
  },
  {
    urls: [
      "https://x.com/i/api/graphql/*",
      "https://twitter.com/i/api/graphql/*",
    ],
  },
  ["blocking"]
);

// --- Download handler ---

function fileExtension(url) {
  try {
    const pathname = new URL(url).pathname;
    const parts = pathname.split('.');
    return parts.length > 1 ? parts[parts.length - 1] : 'mp4';
  } catch (_) {
    return 'mp4';
  }
}

browser.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'DOWNLOAD_MEDIA') {
    const items = message.items || [];

    // Separate images and non-images
    const images = items.filter(i => i.type === 'image');
    const nonImages = items.filter(i => i.type !== 'image');

    // Download videos/gifs individually
    for (const item of nonImages) {
      const ext = fileExtension(item.url);
      browser.downloads.download({
        url: item.url,
        filename: `${item.readableFilename}.${ext}`,
        conflictAction: 'uniquify',
      }).catch(err => {
        console.error('[X Multi Video DL] Download failed:', err, item.url);
      });
    }

    // Images: single → individual download, multiple → ZIP
    if (images.length === 1) {
      const item = images[0];
      const ext = fileExtension(item.url);
      browser.downloads.download({
        url: item.url,
        filename: `${item.readableFilename}.${ext}`,
        conflictAction: 'uniquify',
      }).catch(err => {
        console.error('[X Multi Video DL] Download failed:', err, item.url);
      });
    } else if (images.length > 1) {
      downloadImagesAsZip(images);
    }
  }
});

async function downloadImagesAsZip(images) {
  try {
    const zip = new JSZip();

    // Fetch all images in parallel
    const fetchPromises = images.map(async (item) => {
      const ext = fileExtension(item.url);
      const filename = `${item.readableFilename}.${ext}`;
      const response = await fetch(item.url);
      if (!response.ok) throw new Error(`Failed to fetch ${item.url}: ${response.status}`);
      const blob = await response.blob();
      return { filename, blob };
    });

    const results = await Promise.all(fetchPromises);
    for (const { filename, blob } of results) {
      zip.file(filename, blob);
    }

    // Generate ZIP blob
    const zipBlob = await zip.generateAsync({ type: 'blob' });

    // ZIP filename: use the base name without the -N suffix
    // e.g. "user-123456-20240101_120000" from "user-123456-20240101_120000-1"
    const baseName = images[0].readableFilename.replace(/-\d+$/, '');
    const zipUrl = URL.createObjectURL(zipBlob);

    browser.downloads.download({
      url: zipUrl,
      filename: `${baseName}.zip`,
      conflictAction: 'uniquify',
    }).then(() => {
      // Revoke after a delay to ensure download starts
      setTimeout(() => URL.revokeObjectURL(zipUrl), 60000);
    }).catch(err => {
      console.error('[X Multi Video DL] ZIP download failed:', err);
      URL.revokeObjectURL(zipUrl);
    });
  } catch (err) {
    console.error('[X Multi Video DL] ZIP creation failed:', err);
    // Fallback: download images individually
    for (const item of images) {
      const ext = fileExtension(item.url);
      browser.downloads.download({
        url: item.url,
        filename: `${item.readableFilename}.${ext}`,
        conflictAction: 'uniquify',
      }).catch(e => console.error('[X Multi Video DL] Fallback download failed:', e));
    }
  }
}
