import { describe, expect, it } from 'vitest'

import { defaultAccountName, isPhoneIdentifier, normalizePhone, PHONE_ACCOUNT_DOMAIN, toAccountEmail, toDisplayIdentifier } from './phone-account'

describe('phone account identifier', () => {
  describe('isPhoneIdentifier', () => {
    it('accepts mainland mobile numbers written with separators', () => {
      expect(isPhoneIdentifier('13800138000')).toBe(true)
      expect(isPhoneIdentifier('138 0013 8000')).toBe(true)
      expect(isPhoneIdentifier('138-0013-8000')).toBe(true)
    })

    it('rejects landlines, short numbers, and email addresses', () => {
      expect(isPhoneIdentifier('010-12345678')).toBe(false)
      expect(isPhoneIdentifier('1380013800')).toBe(false)
      expect(isPhoneIdentifier('nurse@example.com')).toBe(false)
    })
  })

  describe('normalizePhone', () => {
    it('drops spaces and dashes', () => {
      expect(normalizePhone('138 0013-8000')).toBe('13800138000')
    })
  })

  describe('toAccountEmail', () => {
    it('maps a phone number onto the reserved local domain', () => {
      expect(toAccountEmail('13800138000')).toBe(`13800138000@${PHONE_ACCOUNT_DOMAIN}`)
    })

    it('normalizes separators before mapping', () => {
      expect(toAccountEmail(' 138 0013-8000 ')).toBe(`13800138000@${PHONE_ACCOUNT_DOMAIN}`)
    })

    it('passes an email address through unchanged', () => {
      expect(toAccountEmail(' nurse@example.com ')).toBe('nurse@example.com')
    })
  })

  describe('toDisplayIdentifier', () => {
    it('strips the reserved domain so a visitor reads their number', () => {
      expect(toDisplayIdentifier(`13800138000@${PHONE_ACCOUNT_DOMAIN}`)).toBe('13800138000')
    })

    it('keeps a real email address intact', () => {
      expect(toDisplayIdentifier('nurse@example.com')).toBe('nurse@example.com')
    })
  })

  describe('defaultAccountName', () => {
    it('uses the phone number as the display name', () => {
      expect(defaultAccountName('138 0013 8000')).toBe('13800138000')
    })

    it('uses the email local part for an email identifier', () => {
      expect(defaultAccountName('nurse@example.com')).toBe('nurse')
    })
  })
})
