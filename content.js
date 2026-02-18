// Twitter Media Downloader - Content Script
// Injects download buttons into tweets and triggers bulk download

const LOG_PREFIX = '[Twitter Media DL]';
const EXTENSION_KEY = 'x-multi-video-dl';

const DOWNLOAD_SVG = '<g><path d="M 21 15 L 20.98 18.51 C 20.98 19.89 19.86 21 18.48 21 L 5.5 21 C 4.11 21 3 19.88 3 18.5 L 3 15 L 5 15 L 5 18.5 C 5 18.78 5.22 19 5.5 19 L 18.48 19 C 18.76 19 18.98 18.78 18.98 18.5 L 19 15 L 21 15 Z M 12 16 L 17.7 10.3 L 16.29 8.88 L 13 12.18 L 13 2.59 L 11 2.59 L 11 12.18 L 7.7 8.88 L 6.29 10.3 L 12 16 Z"/></g>';

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

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return '';
}

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

browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'UPDATE_MEDIA_DATA') {
    const current = getMediaCache();
    const merged = [...current];
    const existingKeys = new Set(current.map(m => `${m.tweetId}:${m.url}`));
    for (const item of message.data || []) {
      const key = `${item.tweetId}:${item.url}`;
      if (!existingKeys.has(key)) {
        merged.push(item);
        existingKeys.add(key);
      }
    }
    setMediaCache(merged);
    updateAllBadges();
  }
});

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

function hasMedia(element) {
  return element.querySelector('[data-testid="tweetPhoto"], [data-testid="videoPlayer"], video') !== null;
}

// --- Badge ---

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
  const mediaCount = getMediaCache().filter(m => m.tweetId === tweetId).length;
  const badge = btn.querySelector('.xmvd-badge');
  if (!badge) return;

  if (mediaCount > 1) {
    badge.textContent = mediaCount.toString();
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

// --- Download button creation (shared logic) ---

function createDownloadButton(templateBtn, onClick) {
  const dlBtn = templateBtn.cloneNode(true);
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
    innerBtn.dataset.testid = 'xmvd-download';
  }

  const countSpan = dlBtn.querySelector('span[data-testid]');
  if (countSpan) countSpan.textContent = '';

  const badge = document.createElement('span');
  badge.className = 'xmvd-badge';
  badge.style.display = 'none';
  dlBtn.appendChild(badge);

  dlBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    onClick();
  });

  const hoverDiv = dlBtn.querySelector('div');
  if (hoverDiv) {
    dlBtn.addEventListener('mouseenter', () => { hoverDiv.style.color = 'rgb(29, 155, 240)'; });
    dlBtn.addEventListener('mouseleave', () => { hoverDiv.style.color = ''; });
  }

  return dlBtn;
}

// --- Button injection ---

function injectDownloadButton(article) {
  if (article.querySelector('.xmvd-download-btn')) return;
  if (!hasMedia(article)) return;

  const groups = article.querySelectorAll('div[role="group"]');
  if (!groups.length) return;
  const actionBar = groups[groups.length - 1];
  const templateBtn = actionBar.lastElementChild;
  if (!templateBtn) return;

  const dlBtn = createDownloadButton(templateBtn, () => {
    const tweetId = extractTweetId(article);
    if (tweetId) downloadByTweetId(tweetId);
  });

  actionBar.appendChild(dlBtn);

  const tweetId = extractTweetId(article);
  if (tweetId) updateBadge(dlBtn, tweetId);
}

function injectModalDownloadButton(modal) {
  if (modal.querySelector('.xmvd-download-btn')) return;

  const group = modal.querySelector('div[role="group"]');
  if (!group) return;
  const templateBtn = group.lastElementChild;
  if (!templateBtn) return;

  const dlBtn = createDownloadButton(templateBtn, () => {
    const urlMatch = window.location.pathname.match(/\/status\/(\d+)/);
    if (urlMatch) downloadByTweetId(urlMatch[1]);
  });

  group.appendChild(dlBtn);
}

// --- Download logic ---

function downloadByTweetId(tweetId) {
  const cache = getMediaCache();
  const media = cache.filter(m => m.tweetId === tweetId || m.referencedBy === tweetId);

  if (media.length === 0) {
    console.log(LOG_PREFIX, 'Cache empty, falling back to direct fetch');
    fetchAndDownload(tweetId);
    return;
  }

  browser.runtime.sendMessage({ type: 'DOWNLOAD_MEDIA', items: media });
  showDownloadFeedback(tweetId);
}

// --- Fallback: direct GraphQL fetch ---

function findTweetsWithMedia(obj, seen = new WeakSet()) {
  const results = [];
  if (!obj || typeof obj !== 'object') return results;
  if (seen.has(obj)) return results;
  seen.add(obj);

  const legacy = obj.legacy || obj.tweet?.legacy;
  const core = obj.core || obj.tweet?.core;
  if (legacy?.extended_entities?.media && core?.user_results?.result?.legacy?.screen_name) {
    results.push({
      legacy,
      screenName: core.user_results.result.legacy.screen_name,
      tweetId: legacy.id_str,
    });
  }

  const entries = Array.isArray(obj) ? obj.entries() : Object.entries(obj);
  for (const [, value] of entries) {
    if (value && typeof value === 'object') {
      results.push(...findTweetsWithMedia(value, seen));
    }
  }
  return results;
}

function extractMediaItems(targetTweet) {
  const { screenName, legacy } = targetTweet;
  const mediaArr = legacy.extended_entities.media;
  const dateStr = formatTweetDate(legacy.created_at);
  const datePart = dateStr ? `-${dateStr}` : '';
  const items = [];

  for (let i = 0; i < mediaArr.length; i++) {
    const media = mediaArr[i];
    const readableFilename = buildFilename(screenName, targetTweet.tweetId, datePart, i, mediaArr.length);

    if (media.type === 'video' || media.type === 'animated_gif') {
      const url = getBestMp4Url(media.video_info?.variants || []);
      if (url) {
        items.push({
          type: media.type === 'video' ? 'video' : 'gif',
          url, readableFilename, tweetId: targetTweet.tweetId,
        });
      }
    } else if (media.type === 'photo' && media.media_url_https) {
      items.push({
        type: 'image',
        url: getOriginalPhotoUrl(media.media_url_https),
        readableFilename, tweetId: targetTweet.tweetId,
      });
    }
  }
  return items;
}

async function fetchAndDownload(tweetId) {
  const token = getCookie('ct0');
  if (!token) {
    console.error(LOG_PREFIX, 'No csrf token found');
    return;
  }

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

  const url = `https://${window.location.hostname}/i/api/graphql/-Ls3CrSQNo2fRKH6i6Na1A/TweetDetail?variables=${variables}&features=${features}`;

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
      console.error(LOG_PREFIX, `Fetch failed: ${response.status}`);
      return;
    }

    const json = await response.json();
    const tweets = findTweetsWithMedia(json);
    const targetTweet = tweets.find(t => t.tweetId === tweetId);

    if (!targetTweet) {
      console.error(LOG_PREFIX, `No media found for tweet ${tweetId}`);
      return;
    }

    const items = extractMediaItems(targetTweet);
    if (items.length) {
      browser.runtime.sendMessage({ type: 'DOWNLOAD_MEDIA', items });
      showDownloadFeedback(tweetId);
    }
  } catch (e) {
    console.error(LOG_PREFIX, 'Fallback fetch failed:', e);
  }
}

// --- Visual feedback ---

function showDownloadFeedback(tweetId) {
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
  document.querySelectorAll('article').forEach(injectDownloadButton);

  const modal = document.querySelector('div[aria-modal="true"]');
  if (modal) injectModalDownloadButton(modal);
}

const observer = new MutationObserver(scanAndInject);
observer.observe(document.body, { childList: true, subtree: true });
scanAndInject();
