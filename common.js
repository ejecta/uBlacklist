const $ = s => document.getElementById(s);

const _ = s => chrome.i18n.getMessage(s);

const lines = s => s ? s.split('\n') : [];
const unlines = ss => ss.join('\n');

/* Async APIs */

const makeAsyncApi = callbackApi => (...args) => new Promise((resolve, reject) => {
  callbackApi(...args, result => {
    if (chrome.runtime.lastError) {
      reject(new Error(chrome.runtime.lastError.message));
      return;
    }
    resolve(result);
  });
});

const getAuthToken = makeAsyncApi((details, callback) => {
  chrome.identity.getAuthToken(details, callback);
});

const removeCachedAuthToken = makeAsyncApi((details, callback) => {
  chrome.identity.removeCachedAuthToken(details, callback);
});

const getLocalStorage = makeAsyncApi((keys, callback) => {
  chrome.storage.local.get(keys, callback);
});

const setLocalStorage = makeAsyncApi((items, callback) => {
  chrome.storage.local.set(items, callback);
});

const queryTabs = makeAsyncApi((queryInfo, callback) => {
  chrome.tabs.query(queryInfo, callback);
});

/* Block Rules */

class SimpleURL {
  constructor(href) {
    const u = new URL(href);
    this.scheme = u.protocol.slice(0, -1);
    this.host = u.hostname;
    this.path = `${u.pathname}${u.search}`;
  }

  get href() {
    return `${this.scheme}://${this.host}${this.path}`;
  }
}

class BlockRule {
  constructor(raw) {
    this.raw = raw;
    const trimmed = raw.trim();
    const mp = trimmed.match(/^(\*|https?|ftp):\/\/(\*|(?:\*\.)?[^/*]+)(\/.*)$/);
    if (mp) {
      this.matchPattern = {
        scheme: mp[1],
        host: mp[2],
        path: new RegExp(`^${mp[3].replace(/[$^\\.+?()[\]{}|]/g, '\\$&').replace(/\*/g, '.*')}$`)
      };
      return;
    }
    const re = trimmed.match(/^\/((?:[^*\\/[]|\\.|\[(?:[^\]\\]|\\.)*\])(?:[^\\/[]|\\.|\[(?:[^\]\\]|\\.)*\])*)\/(.*)$/);
    if (re) {
      try {
        let regExp = new RegExp(re[1], re[2]);
        if (regExp.global || regExp.sticky) {
          regExp = new RegExp(regExp, re[2].replace(/[gy]/g, ''));
        }
        this.regExp = regExp;
      } catch (e) {
        console.warn(`Invalid regular expression: ${trimmed}`);
      }
    }
  }

  get isValid() {
    return Boolean(this.matchPattern || this.regExp);
  }

  test(url) {
    if (this.matchPattern) {
      const mp = this.matchPattern;
      if (mp.host == '*') {
      } else if (mp.host.startsWith('*.')) {
        if (url.host != mp.host.slice(2) && !url.host.endsWith(mp.host.slice(1))) {
          return false;
        }
      } else if (url.host != mp.host) {
        return false;
      }
      if (mp.scheme == '*') {
        if (url.scheme != 'http' && url.scheme != 'https') {
          return false;
        }
      } else if (url.scheme != mp.scheme) {
        return false;
      }
      return mp.path.test(url.path);
    } else if (this.regExp) {
      return this.regExp.test(url.href);
    } else {
      return false;
    }
  }
}

const loadBlockRules = async () => {
  const {blacklist} = await getLocalStorage({blacklist: ''});
  return lines(blacklist).map(raw => new BlockRule(raw));
};

const saveBlockRules = async blockRules => {
  await setLocalStorage({
    blacklist: unlines(blockRules.map(rule => rule.raw)),
    timestamp: new Date().toISOString()
  });
  chrome.runtime.sendMessage({});
};

const deriveBlockRule = url => {
  if (url.scheme == 'http' || url.scheme == 'https') {
    return `*://${url.host}/*`;
  } else if (url.scheme == 'ftp') {
    return `${url.scheme}://${url.host}/*`;
  } else {
    return '';
  }
};
