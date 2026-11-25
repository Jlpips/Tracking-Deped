import { toCsv } from './csv'

describe('toCsv', () => {
  it('writes BOM, CRLF, quotes every field, doubles quotes, neutralises formulas (Review Focus 4)', () => {
    expect(toCsv(['A', 'B'], [['x,"y"\nz', '=SUM(1)'], ['Peñafrancia', null]])).toBe(
      '\uFEFF"A","B"\r\n"x,""y""\nz","\'=SUM(1)"\r\n"Peñafrancia",""',
    )
  })
  it('prefixes fields starting with + - @', () => {
    expect(toCsv(['A'], [['+1'], ['-2'], ['@x'], ['a=b']])).toBe(
      '\uFEFF"A"\r\n"\'+1"\r\n"\'-2"\r\n"\'@x"\r\n"a=b"',
    )
  })
  it('prefixes fields starting with a tab or carriage return', () => {
    expect(toCsv(['A'], [['\t=1+2'], ['\r=1+2'], ['a\tb']])).toBe(
      '\uFEFF"A"\r\n"\'\t=1+2"\r\n"\'\r=1+2"\r\n"a\tb"',
    )
  })
})
