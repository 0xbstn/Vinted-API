const fetch = require('node-fetch');
const UserAgent = require('user-agents');
const cookie = require('cookie');
const { HttpsProxyAgent } = require('https-proxy-agent');
const axios = require("axios")
/**
 * Fetches a new public cookie from Vinted.fr
 */

const fetchCookie = (domain = 'be') => {
    return new Promise((resolve, reject) => {
        const controller = new AbortController();
        fetch(`https://vinted.fr`, {
            signal: controller.signal,
            headers:{
                "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
                "accept-language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
                "sec-ch-ua": "\" Not A;Brand\";v=\"99\", \"Chromium\";v=\"101\", \"Google Chrome\";v=\"101\"",
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": "\"Windows\"",
                "sec-fetch-dest": "document",
                "sec-fetch-mode": "navigate",
                "sec-fetch-site": "none",
                "sec-fetch-user": "?1",
                "upgrade-insecure-requests": "1",
            },
            agent: process.env.VINTED_API_HTTPS_PROXY ? new HttpsProxyAgent(process.env.VINTED_API_HTTPS_PROXY) : undefined
        }).then((res) => {
            console.log(res.headers)
            const sessionCookie = res.headers.get('set-cookie');
            controller.abort();
            resolve(cookie.parse(sessionCookie)['secure, _vinted_fr_session']);
        }).catch(() => {
            controller.abort();
            reject();
        });
    });
}

/**
 * Parse a vinted URL to get the querystring usable in the search endpoint
 */
const parseVintedURL = (url, disableOrder, allowSwap, customParams = {}) => {
    try {
        const decodedURL = decodeURI(url);
        const matchedParams = decodedURL.match(/^https:\/\/www\.vinted\.([a-z]+)/);
        if (!matchedParams) return {
            validURL: false
        };

        const missingIDsParams = ['catalog', 'status'];
        const params = decodedURL.match(/(?:([a-z_]+)(\[\])?=([a-zA-Z 0-9._À-ú+%]*)&?)/g);
        if (typeof matchedParams[Symbol.iterator] !== 'function') return {
            validURL: false
        };
        const mappedParams = new Map();
        for (let param of params) {
            let [ _, paramName, isArray, paramValue ] = param.match(/(?:([a-z_]+)(\[\])?=([a-zA-Z 0-9._À-ú+%]*)&?)/);
            if (paramValue?.includes(' ')) paramValue = paramValue.replace(/ /g, '+');
            if (isArray) {
                if (missingIDsParams.includes(paramName)) paramName = `${paramName}_id`;
                if (mappedParams.has(`${paramName}s`)) {
                    mappedParams.set(`${paramName}s`, [ ...mappedParams.get(`${paramName}s`), paramValue ]);
                } else {
                    mappedParams.set(`${paramName}s`, [paramValue]);
                }
            } else {
                mappedParams.set(paramName, paramValue);
            }
        }
        for (let key of Object.keys(customParams)) {
            mappedParams.set(key, customParams[key]);
        }
        const finalParams = [];
        for (let [ key, value ] of mappedParams.entries()) {
            finalParams.push(typeof value === 'string' ? `${key}=${value}` : `${key}=${value.join(',')}`);
        }

        return {
            validURL: true,
            domain: matchedParams[1],
            querystring: finalParams.join('&')
        }
    } catch (e) {
        return {
            validURL: false
        }
    }
}

const cookies = new Map();

/**
 * Searches something on Vinted
 */
const search = (url, disableOrder = false, allowSwap = false, customParams = {}) => {
    return new Promise(async (resolve, reject) => {

        const { validURL, domain, querystring } = parseVintedURL(url, disableOrder ?? false, allowSwap ?? false, customParams);
        
        if (!validURL) {
            console.log(`[!] ${url} is not valid in search!`);
            return resolve([]);
        }

        const cachedCookie = cookies.get(domain);
        const cookie = cachedCookie && cachedCookie.createdAt > Date.now() - 60_000 ? cachedCookie.cookie : await fetchCookie(domain).catch(() => {});
        if (!cookie) {
            return reject('Could not fetch cookie');
        }
        if (!cachedCookie || cachedCookie.cookie !== cookie) {
            cookies.set(domain, {
                cookie,
                createdAt: Date.now()
            });
        }

        const controller = new AbortController();
        fetch(`https://www.vinted.be/api/v2/catalog/items?${querystring}`, {
            signal: controller.signal,
            agent: process.env.VINTED_API_HTTPS_PROXY ? new HttpsProxyAgent(process.env.VINTED_API_HTTPS_PROXY) : undefined,
            headers: {
                cookie: '_vinted_fr_session=' + cookie,
                'user-agent': new UserAgent().toString(),
                accept: 'application/json, text/plain, */*'
            }
        }).then((res) => {
            res.text().then((text) => {
                controller.abort();
                try {
                    resolve(JSON.parse(text));
                } catch (e) {
                    reject(text);
                }
            });
        }).catch(() => {
            controller.abort();
            reject('Can not fetch search API');
        });
    
    });
}

module.exports = {
    fetchCookie,
    parseVintedURL,
    search
}
