const MAX_ACTIVE_REQUESTS = 2;
let active = 0;
const queue = [];

function acquire() {
  return new Promise(resolve => {
    const enter = () => { active++; resolve(); };
    if (active < MAX_ACTIVE_REQUESTS) enter();
    else queue.push(enter);
  });
}

function release() {
  active = Math.max(0, active - 1);
  queue.shift()?.();
}

export async function limitedFetch(input, init={}) {
  await acquire();
  try { return await fetch(input, init); }
  finally { release(); }
}

export function requestLimitState() {
  return {active, queued:queue.length, max:MAX_ACTIVE_REQUESTS};
}
