// X Multi Video Downloader - Content Script
// Injects download buttons into tweets and triggers bulk download

console.log('[X Multi Video DL] Content script loaded on', window.location.href);

const EXTENSION_KEY = 'x-multi-video-dl';

// SVG icon for the download button
const DOWNLOAD_SVG = '<g><path d="M 21 15 L 20.98 18.51 C 20.98 19.89 19.86 21 18.48 21 L 5.5 21 C 4.11 21 3 19.88 3 18.5 L 3 15 L 5 15 L 5 18.5 C 5 18.78 5.22 19 5.5 19 L 18.48 19 C 18.76 19 18.98 18.78 18.98 18.5 L 19 15 L 21 15 Z M 12 16 L 17.7 10.3 L 16.29 8.88 L 13 12.18 L 13 2.59 L 11 2.59 L 11 12.18 L 7.7 8.88 L 6.29 10.3 L 12 16 Z"/></g>';

// --- SessionStorage media cache ---

function getMediaCache() {
  try {
    return JSON.parse(sessionStorage.getItem(EXTENSION_KEY) || '[]');
  } catch (_) {
    return [];
  }
}

function setMediaCache(data) {
  sessionStorage.setItem(EXTENSION_KEY, JSON.stringify(data));
}

// Listen for media data from background script
browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'UPDATE_MEDIA_DATA') {
    const current = getMediaCache();
    const newData = message.data || [];
    // Merge and deduplicate
    const merged = [...current];
    const existingKeys = new Set(current.map(m => `${m.tweetId}:${m.url}`));
    for (const item of newData) {
      const key = `${item.tweetId}:${item.url}`;
      if (!existingKeys.has(key)) {
        merged.push(item);
        existingKeys.add(key);
      }
    }
    setMediaCache(merged);
    // Re-check existing articles for badge updates
    updateAllBadges();
  }
});

// Clear cache on page navigation
window.addEventListener('pageshow', () => {
  sessionStorage.removeItem(EXTENSION_KEY);
});

// --- Tweet ID extraction ---

function extractTweetId(article) {
  const links = article.querySelectorAll('a[href*="/status/"]');
  for (const link of links) {
    if (link.querySelector('time')) {
      const match = link.href.match(/\/status\/(\d+)/);
      if (match) return match[1];
    }
  }
  return null;
}

// --- Check if tweet has media ---

function hasMedia(element) {
  return element.querySelector('[data-testid="tweetPhoto"]') !== null ||
         element.querySelector('[data-testid="videoPlayer"]') !== null ||
         element.querySelector('video') !== null;
}

// --- Badge update ---

function updateAllBadges() {
  document.querySelectorAll('article').forEach(article => {
    const btn = article.querySelector('.xmvd-download-btn');
    if (!btn) return;
    const tweetId = extractTweetId(article);
    if (!tweetId) return;
    updateBadge(btn, tweetId);
  });
}

function updateBadge(btn, tweetId) {
  const cache = getMediaCache();
  const videos = cache.filter(m => m.tweetId === tweetId && (m.type === 'video' || m.type === 'gif'));
  const allMedia = cache.filter(m => m.tweetId === tweetId);
  const badge = btn.querySelector('.xmvd-badge');

  if (allMedia.length > 1 && badge) {
    badge.textContent = allMedia.length.toString();
    badge.style.display = '';
  } else if (badge) {
    badge.style.display = 'none';
  }
}

// --- Download button injection ---

function injectDownloadButton(article) {
  // Skip if already injected
  if (article.querySelector('.xmvd-download-btn')) return;

  // Only inject on tweets with media (images/videos)
  if (!hasMedia(article)) return;

  // Find the action bar (the last div[role="group"] in the article)
  const groups = article.querySelectorAll('div[role="group"]');
  if (!groups.length) return;
  const actionBar = groups[groups.length - 1];

  console.log('[X Multi Video DL] Injecting button into article, tweetId:', extractTweetId(article));

  // Clone the last action button as template for consistent styling
  const lastChild = actionBar.lastElementChild;
  if (!lastChild) return;

  const dlBtn = lastChild.cloneNode(true);
  dlBtn.classList.add('xmvd-download-btn');

  // Replace inner SVG with download icon
  const svg = dlBtn.querySelector('svg');
  if (svg) {
    svg.innerHTML = DOWNLOAD_SVG;
    svg.setAttribute('viewBox', '0 0 24 24');
  }

  // Clean up cloned button state
  const innerBtn = dlBtn.querySelector('button');
  if (innerBtn) {
    innerBtn.removeAttribute('aria-disabled');
    innerBtn.removeAttribute('disabled');
    innerBtn.setAttribute('aria-label', 'Download media');
    innerBtn.dataset.testid = 'xmvd-download';
  }

  // Remove any count/text spans that were cloned
  const countSpan = dlBtn.querySelector('span[data-testid]');
  if (countSpan) countSpan.textContent = '';

  // Add badge for media count
  const badge = document.createElement('span');
  badge.className = 'xmvd-badge';
  badge.style.display = 'none';
  dlBtn.appendChild(badge);

  // Click handler
  dlBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    handleDownloadClick(article);
  });

  // Add hover effect class to the wrapper
  const hoverDiv = dlBtn.querySelector('div');
  if (hoverDiv) {
    dlBtn.addEventListener('mouseenter', () => {
      hoverDiv.style.color = 'rgb(29, 155, 240)';
    });
    dlBtn.addEventListener('mouseleave', () => {
      hoverDiv.style.color = '';
    });
  }

  actionBar.appendChild(dlBtn);

  // Update badge immediately
  const tweetId = extractTweetId(article);
  if (tweetId) {
    updateBadge(dlBtn, tweetId);
  }
}

// --- Modal download button ---

function injectModalDownloadButton(modal) {
  if (modal.querySelector('.xmvd-download-btn')) return;

  const group = modal.querySelector('div[role="group"]');
  if (!group) return;

  const lastChild = group.lastElementChild;
  if (!lastChild) return;

  const dlBtn = lastChild.cloneNode(true);
  dlBtn.classList.add('xmvd-download-btn');

  const svg = dlBtn.querySelector('svg');
  if (svg) {
    svg.innerHTML = DOWNLOAD_SVG;
    svg.setAttribute('viewBox', '0 0 24 24');
  }

  const innerBtn = dlBtn.querySelector('button');
  if (innerBtn) {
    innerBtn.removeAttribute('aria-disabled');
    innerBtn.removeAttribute('disabled');
    innerBtn.setAttribute('aria-label', 'Download media');
  }

  const badge = document.createElement('span');
  badge.className = 'xmvd-badge';
  badge.style.display = 'none';
  dlBtn.appendChild(badge);

  dlBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    // In modal, get tweet ID from URL
    const urlMatch = window.location.pathname.match(/\/status\/(\d+)/);
    if (urlMatch) {
      downloadByTweetId(urlMatch[1]);
    }
  });

  group.appendChild(dlBtn);
}

// --- Download logic ---

function handleDownloadClick(article) {
  const tweetId = extractTweetId(article);
  if (!tweetId) {
    console.warn('[X Multi Video DL] Could not find tweet ID');
    return;
  }
  downloadByTweetId(tweetId);
}

function downloadByTweetId(tweetId) {
  const cache = getMediaCache();
  console.log(`[X Multi Video DL] Cache has ${cache.length} items total`);
  const media = cache.filter(m => m.tweetId === tweetId || m.referencedBy === tweetId);
  console.log(`[X Multi Video DL] Found ${media.length} media for tweet ${tweetId}`);

  if (media.length === 0) {
    // Fallback: try fetching via GraphQL API directly
    console.log('[X Multi Video DL] Cache empty, falling back to direct fetch');
    fetchAndDownload(tweetId);
    return;
  }

  console.log('[X Multi Video DL] Sending DOWNLOAD_MEDIA to background', media);
  browser.runtime.sendMessage({
    type: 'DOWNLOAD_MEDIA',
    items: media,
  });

  showDownloadFeedback(tweetId, media.length);
}

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

// Recursively find tweet objects with extended_entities.media in any JSON structure
function findTweetsWithMedia(obj, seen = new WeakSet()) {
  const results = [];
  if (!obj || typeof obj !== 'object') return results;
  if (seen.has(obj)) return results;
  seen.add(obj);

  // Check if this object looks like a tweet with media
  const legacy = obj.legacy || obj.tweet?.legacy;
  const core = obj.core || obj.tweet?.core;
  if (legacy?.extended_entities?.media && core?.user_results?.result?.legacy?.screen_name) {
    results.push({
      legacy,
      screenName: core.user_results.result.legacy.screen_name,
      tweetId: legacy.id_str,
    });
  }

  // Recurse into all child objects/arrays
  const entries = Array.isArray(obj) ? obj.entries() : Object.entries(obj);
  for (const [, value] of entries) {
    if (value && typeof value === 'object') {
      results.push(...findTweetsWithMedia(value, seen));
    }
  }
  return results;
}

async function fetchAndDownload(tweetId) {
  // Get csrf token from cookie
  const token = getCookie('ct0');
  if (!token) {
    console.error('[X Multi Video DL] No csrf token found');
    return;
  }

  const hostname = window.location.hostname;
  const variables = encodeURIComponent(JSON.stringify({
    focalTweetId: tweetId,
    with_rux_injections: false,
    includePromotedContent: true,
    withCommunity: true,
    withQuickPromoteEligibilityTweetFields: true,
    withBirdwatchNotes: true,
    withVoice: true,
    withV2Timeline: true,
  }));
  const features = encodeURIComponent(JSON.stringify({
    rweb_lists_timeline_redesign_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    tweetypie_unmention_optimization_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: false,
    tweet_awards_web_tipping_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_media_download_video_enabled: false,
    responsive_web_enhance_cards_enabled: false,
  }));

  const url = `https://${hostname}/i/api/graphql/-Ls3CrSQNo2fRKH6i6Na1A/TweetDetail?variables=${variables}&features=${features}`;

  try {
    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        'Accept': '*/*',
        'content-type': 'application/json',
        'x-twitter-auth-type': 'OAuth2Session',
        'x-csrf-token': token,
        'x-twitter-active-user': 'yes',
        'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
      },
    });

    if (!response.ok) {
      console.error(`[X Multi Video DL] Fetch failed: ${response.status} ${response.statusText}`);
      return;
    }
    const json = await response.json();
    console.log('[X Multi Video DL] GraphQL response received', Object.keys(json));
    // Debug: log top-level data structure
    if (json.data) {
      console.log('[X Multi Video DL] Response data keys:', Object.keys(json.data));
    }

    // Use recursive search to find tweets with media (handles any response structure)
    const tweets = findTweetsWithMedia(json);
    console.log(`[X Multi Video DL] Found ${tweets.length} tweets with media in response`);

    // Filter for the target tweet
    const targetTweet = tweets.find(t => t.tweetId === tweetId);
    if (!targetTweet) {
      console.error(`[X Multi Video DL] No tweet with media found for tweetId ${tweetId}`,
        'Found tweet IDs:', tweets.map(t => t.tweetId));
      return;
    }

    const { screenName, legacy } = targetTweet;
    const mediaArr = legacy.extended_entities.media;
    const dateStr = formatTweetDate(legacy.created_at);
    const datePart = dateStr ? `-${dateStr}` : '';
    console.log(`[X Multi Video DL] screenName=${screenName}, media count=${mediaArr.length}, date=${dateStr}`);

    const items = [];
    for (let i = 0; i < mediaArr.length; i++) {
      const media = mediaArr[i];
      const filename = mediaArr.length === 1
        ? `${screenName}-${tweetId}${datePart}`
        : `${screenName}-${tweetId}${datePart}-${i + 1}`;

      if (media.type === 'video' || media.type === 'animated_gif') {
        const variants = (media.video_info?.variants || [])
          .filter(v => v.content_type === 'video/mp4')
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        if (variants.length) {
          items.push({ type: 'video', url: variants[0].url, readableFilename: filename, tweetId });
        }
      } else if (media.type === 'photo') {
        let photoUrl = media.media_url_https;
        try {
          const u = new URL(photoUrl);
          u.searchParams.set('name', 'orig');
          photoUrl = u.toString();
        } catch (_) {}
        items.push({ type: 'image', url: photoUrl, readableFilename: filename, tweetId });
      }
    }

    console.log(`[X Multi Video DL] Prepared ${items.length} items for download`, items);
    if (items.length) {
      browser.runtime.sendMessage({ type: 'DOWNLOAD_MEDIA', items });
      showDownloadFeedback(tweetId, items.length);
    } else {
      console.warn('[X Multi Video DL] No downloadable media found in tweet');
    }
  } catch (e) {
    console.error('[X Multi Video DL] Fallback fetch failed:', e);
  }
}

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return '';
}

// --- Visual feedback ---

function showDownloadFeedback(tweetId, count) {
  // Brief visual feedback on the button
  document.querySelectorAll('article').forEach(article => {
    if (extractTweetId(article) === tweetId) {
      const btn = article.querySelector('.xmvd-download-btn');
      if (btn) {
        btn.classList.add('xmvd-downloading');
        setTimeout(() => btn.classList.remove('xmvd-downloading'), 1500);
      }
    }
  });
}

// --- DOM observation ---

function scanAndInject() {
  document.querySelectorAll('article').forEach(article => {
    injectDownloadButton(article);
  });

  // Check for modal views
  const modal = document.querySelector('div[aria-modal="true"]');
  if (modal) {
    injectModalDownloadButton(modal);
  }
}

const observer = new MutationObserver(() => {
  scanAndInject();
});

observer.observe(document.body, { childList: true, subtree: true });

// Process existing articles on page load
scanAndInject();
