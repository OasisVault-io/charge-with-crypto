// @ts-nocheck
import {
  request,
  AddressPurpose,
  DefaultAdaptersInfo,
  setDefaultProvider,
  removeDefaultProvider,
} from 'sats-connect'

window.ChargeWithCryptoVendors = window.ChargeWithCryptoVendors || {}
window.ChargeWithCryptoVendors.xverse = {
  request,
  AddressPurpose,
  DefaultAdaptersInfo,
  setDefaultProvider,
  removeDefaultProvider,
}
