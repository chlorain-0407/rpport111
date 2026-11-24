import React, { useEffect, useState } from 'react';

type PointNotice = { upgrade_url?: string };
const nativeFetch = window.fetch.bind(window);

function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === 'https:' || (url.protocol === 'http:' && url.origin === location.origin) ? url.href : null;
  } catch { return null; }
}

// All existing same-origin API calls share the same platform error handling.
window.fetch = async (input, init) => {
  const response = await nativeFetch(input, init);
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
  if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return response;
  if (![401, 403, 402].includes(response.status)) return response;
  const body = await response.clone().json().catch(() => null);
  if (response.status === 401 && body?.code === 'LOGIN_REQUIRED') {
    const target = safeUrl(body.login_url);
    if (target) window.location.assign(target);
  }
  if (response.status === 403 && body?.code === 'SUBSCRIPTION_REQUIRED') {
    const target = safeUrl(body.subscribe_url);
    if (target) window.location.assign(target);
  }
  if (response.status === 402 && body?.code === 'INSUFFICIENT_POINTS') {
    window.dispatchEvent(new CustomEvent('academy-points-required', {
      detail: { upgrade_url: safeUrl(body.upgrade_url) },
    }));
  }
  return response;
};

export function AcademyStatus() {
  const [name, setName] = useState<string | null>(null);
  const [notice, setNotice] = useState<PointNotice | null>(null);
  useEffect(() => {
    let active = true;
    fetch('/api/me').then(response => response.ok ? response.json() : null).then(ctx => {
      if (active) setName(ctx?.user?.name || null);
    }).catch(() => {});
    const onPoints = (event: Event) => setNotice((event as CustomEvent<PointNotice>).detail);
    window.addEventListener('academy-points-required', onPoints);
    return () => {
      active = false;
      window.removeEventListener('academy-points-required', onPoints);
    };
  }, []);
  return (
    <>
      {name && <div className="bg-blue-50 p-2 text-center text-sm text-blue-900">研究所會員　{name}</div>}
      {notice && (
        <div role="alert" className="fixed bottom-4 right-4 z-[100] rounded-xl border bg-white p-5 shadow-lg">
          <p className="font-bold">點數不足</p>
          {notice.upgrade_url && <a className="mt-2 block text-blue-700 underline" href={notice.upgrade_url}>查看升級方案</a>}
          <button type="button" className="mt-2" onClick={() => setNotice(null)}>關閉</button>
        </div>
      )}
    </>
  );
}
