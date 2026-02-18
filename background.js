// Twitter Media Downloader - Background Script
// Intercepts GraphQL API responses to extract media data and handles download requests

const LOG_PREFIX = '[Twitter Media DL]';

// --- Utility ---

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

function fileExtension(url) {
  try {
    const parts = new URL(url).pathname.split('.');
    return parts.length > 1 ? parts.pop() : 'mp4';
  } catch (_) {
    return 'mp4';
  }
}

function buildFilename(screenName, tweetId, datePart, index, total) {
  const base = `${screenName}-${tweetId}${datePart}`;
  return total > 1 ? `${base}-${index + 1}` : base;
}

function getBestMp4Url(variants) {
  return variants
    .filter(v => v.content_type === 'video/mp4')
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0]?.url;
}

function getOriginalPhotoUrl(url) {
  try {
    const u = new URL(url);
    u.searchParams.set('name', 'orig');
    return u.toString();
  } catch (_) {
    return url;
  }
}

// --- Media extraction from GraphQL responses ---

function findMediaInObject(obj, seen = new WeakSet()) {
  const results = [];
  if (!obj || typeof obj !== 'object') return results;
  if (seen.has(obj)) return results;
  seen.add(obj);

  const legacy = obj.legacy || obj.tweet?.legacy;
  const core = obj.core || obj.tweet?.core;

  if (legacy?.extended_entities?.media && core?.user_results?.result?.legacy?.screen_name) {
    const screenName = core.user_results.result.legacy.screen_name;
    const tweetId = legacy.id_str;
    const mediaArr = legacy.extended_entities.media;
    const dateStr = formatTweetDate(legacy.created_at);
    const datePart = dateStr ? `-${dateStr}` : '';
    const referencedBy = obj._referencedBy || null;

    for (let i = 0; i < mediaArr.length; i++) {
      const media = mediaArr[i];
      const readableFilename = buildFilename(screenName, tweetId, datePart, i, mediaArr.length);

      if (media.type === 'video' || media.type === 'animated_gif') {
        const url = getBestMp4Url(media.video_info?.variants || []);
        if (url) {
          results.push({
            type: media.type === 'video' ? 'video' : 'gif',
            url, readableFilename, tweetId, referencedBy,
          });
        }
      } else if (media.type === 'photo' && media.media_url_https) {
        results.push({
          type: 'image',
          url: getOriginalPhotoUrl(media.media_url_https),
          readableFilename, tweetId, referencedBy,
        });
      }
    }
  }

  // Mark quoted tweets so we know which parent references them
  if (obj.quoted_status_result?.result && legacy?.id_str) {
    obj.quoted_status_result.result._referencedBy = legacy.id_str;
  }

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
        const medias = deduplicateMedia(findMediaInObject(JSON.parse(responseText)));

        if (medias.length > 0) {
          browser.tabs.sendMessage(details.tabId, {
            type: 'UPDATE_MEDIA_DATA',
            data: medias,
          }).catch(() => {});
        }
      } catch (_) {
        // JSON parse error or other - ignore
      } finally {
        try { filter.close(); }
        catch (_) { filter.disconnect(); }
      }
    };
  },
  {
    urls: [
      'https://x.com/i/api/graphql/*',
      'https://twitter.com/i/api/graphql/*',
    ],
  },
  ['blocking']
);

// --- Download handler ---

function downloadItem(item) {
  const ext = fileExtension(item.url);
  return browser.downloads.download({
    url: item.url,
    filename: `${item.readableFilename}.${ext}`,
    conflictAction: 'uniquify',
  }).catch(err => {
    console.error(LOG_PREFIX, 'Download failed:', err, item.url);
  });
}

async function downloadImagesAsZip(images) {
  try {
    const zip = new JSZip();

    const results = await Promise.all(images.map(async (item) => {
      const ext = fileExtension(item.url);
      const filename = `${item.readableFilename}.${ext}`;
      const response = await fetch(item.url);
      if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
      return { filename, blob: await response.blob() };
    }));

    for (const { filename, blob } of results) {
      zip.file(filename, blob);
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const baseName = images[0].readableFilename.replace(/-\d+$/, '');
    const zipUrl = URL.createObjectURL(zipBlob);

    browser.downloads.download({
      url: zipUrl,
      filename: `${baseName}.zip`,
      conflictAction: 'uniquify',
    }).then(() => {
      setTimeout(() => URL.revokeObjectURL(zipUrl), 60000);
    }).catch(err => {
      console.error(LOG_PREFIX, 'ZIP download failed:', err);
      URL.revokeObjectURL(zipUrl);
    });
  } catch (err) {
    console.error(LOG_PREFIX, 'ZIP creation failed, falling back to individual downloads:', err);
    images.forEach(downloadItem);
  }
}

browser.runtime.onMessage.addListener((message) => {
  if (message.type !== 'DOWNLOAD_MEDIA') return;

  const items = message.items || [];
  const images = items.filter(i => i.type === 'image');
  const nonImages = items.filter(i => i.type !== 'image');

  nonImages.forEach(downloadItem);

  if (images.length <= 1) {
    images.forEach(downloadItem);
  } else {
    downloadImagesAsZip(images);
  }
});
