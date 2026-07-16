import { describe, expect, it } from 'bun:test';

const variableNames = (text: string): readonly string[] =>
  [...text.matchAll(/^\s*(?:ENV\s+)?([A-Z][A-Z0-9_]*)=/gm)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined)
    .sort();

describe('Docker runtime environment contract', () => {
  it('declares every example variable in the runtime image', async () => {
    const [dockerfile, example] = await Promise.all([
      Bun.file('Dockerfile').text(),
      Bun.file('.env.example').text(),
    ]);

    expect(variableNames(dockerfile)).toEqual(variableNames(example));
  });
});
