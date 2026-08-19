export function authenticatedFetch(accessToken: string | (() => string)): typeof fetch {
  return (input, init = {}) => {
    const headers = new Headers(init.headers);
    const token = typeof accessToken === "function" ? accessToken() : accessToken;
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };
}
