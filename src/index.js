import IntlPolyfill from 'intl';
import React from 'react';
import IntlMessageFormat from 'intl-messageformat';
import escapeHtml from 'escape-html';
import cookie from 'cookie';
import queryParser from 'querystring';
import load from 'load-script';
import invariant from 'invariant';
import 'console-polyfill';
import * as constants from './constants';
import merge from 'lodash.merge';
import isElectron from 'is-electron';
import http from 'axios';

const isBrowser =
  !isElectron() &&
  !!(
    typeof window !== 'undefined' &&
    window.document &&
    window.document.createElement
  );

String.prototype.defaultMessage = String.prototype.d = function(msg) {
  if (this.search('GUESTY_KEY=') > -1) {
    const newMsg = this.split('=');
    const body = { fields: {} };
    body.fields.message = { stringValue: msg };
    const httpService = http.create();

    delete httpService.defaults.headers.common['g-aid-cs'];
    console.warn('Guesty translate:', this, newMsg[1], msg);
    httpService.patch(
      `https://firestore.googleapis.com/v1beta1/projects/guesty-18n/databases/(default)/documents/overall/${newMsg[1].trim()}`,
      body,
    );
    return msg || '';
  }
  return this || msg || '';
};

class ReactIntlUniversal {
  constructor() {
    this.options = {
      // Current locale such as 'en-US'
      currentLocale: null,
      // URL's query Key to determine locale. Example: if URL=http://localhost?lang=en-US, then set it 'lang'
      urlLocaleKey: null,
      // Cookie's Key to determine locale. Example: if cookie=lang:en-US, then set it 'lang'
      cookieLocaleKey: null,
      // app locale data like {"en-US":{"key1":"value1"},"zh-CN":{"key1":"值1"}}
      locales: {},
      // ability to accumulate missing messages using third party services like Sentry
      warningHandler: console.warn.bind(console),
      // Common locales js urls
      commonLocaleDataUrls: {},
      // disable escape html in variable mode
      escapeHtml: true,
      // Locale to use if a key is not found in the current locale
      fallbackLocale: null,
    };
  }

  /**
   * Get the formatted message by key
   * @param {string} key The string representing key in locale data file
   * @param {Object} variables Variables in message
   * @returns {string} message
   */
  get(key, variables) {
    invariant(key, 'key is required');
    const { locales, currentLocale, formats, warningHandler } = this.options;

    if (!locales || !locales[currentLocale]) {
      warningHandler &&
        warningHandler(
          `react-intl-universal locales data "${currentLocale}" does not exist.`,
        );

      return '';
    }

    let msg = this.getDescendantProp(locales[currentLocale], key);

    if (msg == null) {
      if (this.options.fallbackLocale) {
        msg = this.getDescendantProp(locales[this.options.fallbackLocale], key);
        if (msg == null) {
          warningHandler &&
            warningHandler(
              `react-intl-universal key "${key}" not defined in ${currentLocale} or the fallback locale, ${
                this.options.fallbackLocale
              }`,
            );
          if (
            window &&
            window.localStorage &&
            window.localStorage.getItem('getLanguages')
          ) {
            return `GUESTY_KEY=${key}`;
          } else {
            return '';
          }
        }
      } else {
        warningHandler &&
          warningHandler(
            `react-intl-universal key "${key}" not defined in ${currentLocale}`,
          );
        if (
          window &&
          window.localStorage &&
          window.localStorage.getItem('getLanguages')
        ) {
          return `GUESTY_KEY=${key}`;
        } else {
          return '';
        }
      }
    }
    if (variables) {
      variables = Object.assign({}, variables);
      // HTML message with variables. Escape it to avoid XSS attack.
      for (let i in variables) {
        let value = variables[i];
        if (
          this.options.escapeHtml === true &&
          (typeof value === 'string' || value instanceof String) &&
          value.indexOf('<') >= 0 &&
          value.indexOf('>') >= 0
        ) {
          value = escapeHtml(value);
        }
        variables[i] = value;
      }
    }

    try {
      const msgFormatter = new IntlMessageFormat(msg, currentLocale, formats);
      return msgFormatter.format(variables);
    } catch (err) {
      warningHandler &&
        warningHandler(
          `react-intl-universal format message failed for key='${key}'.`,
          err.message,
        );
      return msg;
    }
  }

  /**
   * Get the formatted html message by key.
   * @param {string} key The string representing key in locale data file
   * @param {Object} variables Variables in message
   * @returns {React.Element} message
   */
  getHTML(key, variables) {
    let msg = this.get(key, variables);
    if (msg) {
      const el = React.createElement('span', {
        dangerouslySetInnerHTML: {
          __html: msg,
        },
      });
      // when key exists, it should still return element if there's defaultMessage() after getHTML()
      const defaultMessage = () => el;
      return Object.assign(
        { defaultMessage: defaultMessage, d: defaultMessage },
        el,
      );
    }
    if (
      window &&
      window.localStorage &&
      window.localStorage.getItem('getLanguages')
    ) {
      return `GUESTY_KEY=${key}`;
    } else {
      return '';
    }
  }

  /**
   * As same as get(...) API
   * @param {Object} options
   * @param {string} options.id
   * @param {string} options.defaultMessage
   * @param {Object} variables Variables in message
   * @returns {string} message
   */
  formatMessage(messageDescriptor, variables) {
    const { id, defaultMessage } = messageDescriptor;
    return this.get(id, variables).defaultMessage(defaultMessage);
  }

  /**
   * As same as getHTML(...) API
   * @param {Object} options
   * @param {string} options.id
   * @param {React.Element} options.defaultMessage
   * @param {Object} variables Variables in message
   * @returns {React.Element} message
   */
  formatHTMLMessage(messageDescriptor, variables) {
    const { id, defaultMessage } = messageDescriptor;
    return this.getHTML(id, variables).defaultMessage(defaultMessage);
  }

  /**
   * Helper: determine user's locale via URL, cookie, and browser's language.
   * You may not this API, if you have other rules to determine user's locale.
   * @param {string} options.urlLocaleKey URL's query Key to determine locale. Example: if URL=http://localhost?lang=en-US, then set it 'lang'
   * @param {string} options.cookieLocaleKey Cookie's Key to determine locale. Example: if cookie=lang:en-US, then set it 'lang'
   * @returns {string} determined locale such as 'en-US'
   */
  determineLocale(options = {}) {
    return (
      this.getLocaleFromURL(options) ||
      this.getLocaleFromCookie(options) ||
      this.getLocaleFromBrowser()
    );
  }

  /**
   * Initialize properties and load CLDR locale data according to currentLocale
   * @param {Object} options
   * @param {string} options.currentLocale Current locale such as 'en-US'
   * @param {string} options.locales App locale data like {"en-US":{"key1":"value1"},"zh-CN":{"key1":"值1"}}
   * @returns {Promise}
   */
  init(options = {}) {
    invariant(options.currentLocale, 'options.currentLocale is required');
    Object.assign(this.options, options);

    const { currentLocale } = this.options;

    this.options.formats = Object.assign(
      {},
      this.options.formats,
      constants.defaultFormats,
    );

    const langURL = this.getLocaleFromURL({ urlLocaleKey: 'lang' });
    const getLanguagesURL = this.getLocaleFromURL({
      urlLocaleKey: 'getLanguages',
    });

    if (langURL && window && window.localStorage) {
      console.warn('changing lang to ', langURL);
      window.localStorage.setItem('lang', langURL);
    }

    if (getLanguagesURL && window && window.localStorage) {
      console.warn('changing getLanguages to ', getLanguagesURL);
      window.localStorage.setItem('getLanguages', getLanguagesURL);
    } else if (window && window.localStorage) {
      window.localStorage.removeItem('getLanguages');
    }

    return this.loadRemoteScript(currentLocale);
  }

  /**
   * Get the inital options
   */
  getInitOptions() {
    return this.options;
  }

  /**
   * Load more locales after init
   */
  load(locales) {
    merge(this.options.locales, locales);
  }

  loadRemoteScript(lang) {
    const locale = lang.split('-')[0].split('_')[0];
    const { warningHandler } = this.options;

    return new Promise((resolve, reject) => {
      const localeURL = this.options.commonLocaleDataUrls[locale];
      if (isBrowser) {
        if (localeURL) {
          load(localeURL, (err, script) => {
            if (err) {
              warningHandler &&
                warningHandler(`Language file "${lang}.js" was not loaded.`);
            }
            resolve();
          });
        } else {
          warningHandler &&
            warningHandler(`Language "${lang}" is not supported.`);
        }
      } else {
        // For Node.js, common locales are added in the application
        resolve();
      }
    });
  }

  getLocaleFromCookie(options) {
    const { cookieLocaleKey } = options;
    if (cookieLocaleKey) {
      let params = cookie.parse(document.cookie);
      return params && params[cookieLocaleKey];
    }
  }

  getLocaleFromURL(options) {
    const { urlLocaleKey } = options;
    if (urlLocaleKey) {
      let query = location.search.split('?');
      if (query.length >= 2) {
        let params = queryParser.parse(query[1]);
        return params && params[urlLocaleKey];
      }
    }
  }

  getDescendantProp(locale, key) {
    if (locale[key]) {
      return locale[key];
    }

    const msg = key.split('.').reduce(function(a, b) {
      return a != undefined ? a[b] : a;
    }, locale);

    return msg;
  }

  getLocaleFromBrowser() {
    return navigator.language || navigator.userLanguage;
  }
}

module.exports = new ReactIntlUniversal();
