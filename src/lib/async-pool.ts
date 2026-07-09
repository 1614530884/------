/**
 * 通用有界并发执行器
 * 按 limit 并发度处理 items，使用 Promise.allSettled 语义，单个失败不影响其他
 * 结果顺序与输入一致
 */
export async function asyncPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  let active = 0;

  return new Promise((resolve) => {
    if (items.length === 0) {
      resolve(results);
      return;
    }

    const next = (): void => {
      while (active < limit && cursor < items.length) {
        const idx = cursor;
        active++;
        cursor++;
        fn(items[idx], idx)
          .then(
            (value) => { results[idx] = { status: 'fulfilled', value }; },
            (reason) => { results[idx] = { status: 'rejected', reason }; }
          )
          .finally(() => {
            active--;
            if (cursor >= items.length && active === 0) {
              resolve(results);
            } else {
              next();
            }
          });
      }
    };

    next();
  });
}
