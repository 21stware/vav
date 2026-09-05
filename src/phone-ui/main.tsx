import { createPhoneTransport, detectPhoneVariant } from './phoneTransport'
import { installPhoneVav } from './phoneVav'

const variant =
  document.documentElement.dataset.phone === 'extension' ||
  document.documentElement.dataset.phone === 'web'
    ? document.documentElement.dataset.phone
    : detectPhoneVariant()

document.documentElement.dataset.phone = variant
document.documentElement.dataset.platform =
  /win/i.test(navigator.platform) ? 'win32' : /mac/i.test(navigator.platform) ? 'darwin' : 'linux'

const transport = createPhoneTransport(variant)
installPhoneVav(transport)

void import('./mount').then(({ mountPhoneApp }) => {
  mountPhoneApp(transport)
})
