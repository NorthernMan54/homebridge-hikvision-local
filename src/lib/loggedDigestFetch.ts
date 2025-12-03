import DigestFetch from 'digest-fetch';

export function createLoggedDigestFetch(
  username: string,
  password: string,
  options: any,
  log: (msg: string) => void,
) {
  const client = new DigestFetch(username, password, options);
  const getClient = client.getClient.bind(client);

  const logHeaders = (headers: Record<string, any> | Headers | undefined): string => {
    if (!headers) {
      return '{}';
    }
    const headerObj = headers instanceof Headers
      ? Object.fromEntries(headers.entries())
      : { ...headers };

    return JSON.stringify(headerObj);
  };

  const logRequest = (tag: string, method: string, url: string, headers: Record<string, any> | Headers | undefined) => {
    log(`${tag} ${method} ${url} | HEADERS: ${logHeaders(headers)}`);
  };

  const logResponse = (tag: string, method: string, url: string, res: Response) => {
    const headers = Object.fromEntries(res.headers.entries());
    log(`${tag} ${method} ${url} -> ${res.status} | HEADERS: ${logHeaders(headers)}`);
  };

  client.fetch = async function (url: string, requestOptions: RequestInit = {}) {
    const fetch = await getClient();
    const method = requestOptions.method || 'GET';

    // First request with empty or stale auth
    const firstOpts = client.addAuth(url, requestOptions);
    logRequest('➡️ Initial', method, url, firstOpts.headers);
    const res = await fetch(url, firstOpts);

    if (res.status === 401 || (res.status === client.statusCode && client.statusCode)) {
      logResponse('⬅️ Challenge', method, url, res);
      client.hasAuth = false;
      client.parseAuth(res.headers.get('www-authenticate'));

      if (client.hasAuth) {
        const finalOpts = client.addAuth(url, requestOptions);
        logRequest('🔁 Digest', method, url, finalOpts.headers);
        const finalRes = await fetch(url, finalOpts);
        logResponse('⬅️ Final', method, url, finalRes);

        if (finalRes.status === 401 || finalRes.status === client.statusCode) {
          client.hasAuth = false;
        } else {
          client.digest.nc++;
        }

        return finalRes;
      }
    } else {
      client.digest.nc++;
    }

    logResponse('⬅️ Response', method, url, res);
    return res;
  };

  return client;
}
