import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import { normalizeUsername, usernameToEmail } from './username.ts'

Deno.test('usernameToEmail trims and lower-cases', () => {
  assertEquals(usernameToEmail(' 108874 '), '108874@dts.local')
  assertEquals(usernameToEmail('Juan.Dela_Cruz-1'), 'juan.dela_cruz-1@dts.local')
})

Deno.test('usernameToEmail rejects empty and invalid usernames', () => {
  assertThrows(() => usernameToEmail('a b'), Error, 'Invalid username')
  assertThrows(() => usernameToEmail('   '), Error, 'Invalid username')
  assertThrows(() => usernameToEmail('x@y'), Error, 'Invalid username')
})

Deno.test('normalizeUsername returns the stored form, or null when invalid', () => {
  assertEquals(normalizeUsername(' Macalelon-Admin '), 'macalelon-admin')
  assertEquals(normalizeUsername('a b'), null)
  assertEquals(normalizeUsername(''), null)
})
