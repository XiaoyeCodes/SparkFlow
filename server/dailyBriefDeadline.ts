/** A shared source may outlive this reader. Late results cannot modify the edition. */
export async function withinBriefDeadline<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('简报数据等待超时')), milliseconds);
    })]);
  } finally {
    clearTimeout(timer);
  }
}
