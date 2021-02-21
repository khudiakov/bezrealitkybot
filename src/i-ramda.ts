
export async function* iMap<T,U>(fn: (x: T) => Promise<U>, iterator: IterableIterator<T>) {
    let current = iterator.next();
    while (!current.done) {
        const result = await fn(current.value);
        yield result;
        current = iterator.next();
    }
} 

export async function* iForEach<T,U>(fn: (x: T) => Promise<U>, iterator: IterableIterator<T>) {
    let current = iterator.next();
    while (!current.done) {
        await fn(current.value);
        current = iterator.next();
    }
}

export async function tillDone(g: AsyncGenerator) {
    let current = await g.next();
    if (!current.done) {
        current = await g.next();
    }
}
