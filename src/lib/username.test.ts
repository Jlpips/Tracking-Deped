import { usernameToEmail } from './username'

describe('usernameToEmail', () => {
  it('trims and lower-cases', () => {
    expect(usernameToEmail(' 108874 ')).toBe('108874@dts.local')
    expect(usernameToEmail('Juan.Dela_Cruz-1')).toBe('juan.dela_cruz-1@dts.local')
  })
  it('rejects empty and invalid usernames', () => {
    expect(() => usernameToEmail('a b')).toThrow('Invalid username')
    expect(() => usernameToEmail('   ')).toThrow('Invalid username')
    expect(() => usernameToEmail('x@y')).toThrow('Invalid username')
  })
})
