import clone from 'clone'
import log from 'loglevel'
import ObservableStore from 'obs-store'
import EventEmitter from 'safe-event-emitter'
import Web3 from 'web3'

import config from '../config'
import {
  ACTIVITY_ACTION_RECEIVE,
  ACTIVITY_ACTION_SEND,
  ACTIVITY_ACTION_TOPUP,
  BADGES_COLLECTIBLE,
  BADGES_TOPUP,
  BADGES_TRANSACTION,
  ERROR_TIME,
  SUCCESS_TIME,
  THEME_LIGHT_BLUE_NAME,
} from '../utils/enums'
import { get, getEtherscanTransactions, getPastOrders, getWalletOrders, patch, post, remove } from '../utils/httpHelpers'
import { notifyUser } from '../utils/notifications'
import { isErrorObject, prettyPrintData } from '../utils/permissionUtils'
import { formatPastTx, getEthTxStatus, getIFrameOrigin, getUserLanguage, storageAvailable } from '../utils/utils'

// By default, poll every 3 minutes
const DEFAULT_INTERVAL = 180 * 1000
const DEFAULT_BADGES_COMPLETION = {
  [BADGES_COLLECTIBLE]: false,
  [BADGES_TOPUP]: false,
  [BADGES_TRANSACTION]: false,
}

class PreferencesController extends EventEmitter {
  /**
   *
   * @typedef {Object} PreferencesController
   * @param {Object} opts - Overrides the defaults for the initial state of this.store
   * @property {object} store The stored object containing a users preferences, stored in torus-backend
   * @property {string} store.selectedAddress A hex string that matches the currently selected address in the app
   * @property {string} store.selectedCurrency A string showing the user selected currency
   * @property {string} store.theme the user selected theme
   * @property {string} store.locale the user selected locale
   * @property {Array} store.billboard the contents of torus-billboard (depends on the locale)
   * @property {Array} store.contacts the contacts of the user
   * @property {object} store.permissions the stored permissions of the user for different domains
   * @property {string} store.jwtToken the token used to communicate with torus-backend
   */
  constructor(options = {}) {
    super()
    let theme = THEME_LIGHT_BLUE_NAME
    if (storageAvailable('localStorage')) {
      const torusTheme = localStorage.getItem('torus-theme')
      if (torusTheme) {
        theme = torusTheme
      }
    }
    const { initialState = {}, network, provider } = options

    const initState = {
      selectedAddress: '',
      selectedCurrency: 'USD',
      theme,
      locale: getUserLanguage(),
      billboard: {},
      contacts: [],
      permissions: [],
      badgesCompletion: {},
      ...initialState,
    }

    this.initState = clone(initState)

    this.network = network
    this.web3 = new Web3(provider)

    this.fetchedPastTx = []

    this.interval = options.interval || DEFAULT_INTERVAL
    this.jwtToken = ''
    this._jwtToken = ''
    this.store = new ObservableStore(initState)
    this.metadataStore = new ObservableStore({})
    this.errorStore = new ObservableStore('')
    this.successStore = new ObservableStore('')
    this.pastTransactionsStore = new ObservableStore([])
    this.paymentTxStore = new ObservableStore([])
  }

  set jwtToken(token) {
    this._jwtToken = token
    if (token) this.getBillboardContents()
  }

  get headers() {
    return {
      headers: {
        Authorization: `Bearer ${this._jwtToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
    }
  }

  get state() {
    return this.store.getState()
  }

  handleError(error) {
    if (isErrorObject(error)) {
      this.errorStore.putState(`Oops, That didn't work. Pls reload and try again. \n${error.message}`)
    } else if (error && typeof error === 'string') {
      this.errorStore.putState(error)
    } else if (error && typeof error === 'object') {
      const prettyError = prettyPrintData(error)
      const payloadError = prettyError !== '' ? `Error: ${prettyError}` : 'Something went wrong. Pls try again'
      this.errorStore.putState(payloadError)
    } else {
      this.errorStore.putState(error || '')
    }
    setTimeout(() => this.errorStore.putState(''), ERROR_TIME)
  }

  handleSuccess(message) {
    if (message && typeof message === 'string') {
      this.successStore.putState(message)
    } else if (message && typeof message === 'object') {
      const prettyMessage = prettyPrintData(message)
      const payloadMessage = prettyMessage !== '' ? `Success: ${prettyMessage}` : 'Success'
      this.successStore.putState(payloadMessage)
    } else {
      this.successStore.putState(message || '')
    }
    setTimeout(() => this.successStore.putState(''), SUCCESS_TIME)
  }

  async sync(callback, errorCallback) {
    try {
      const user = await get(`${config.api}/user?fetchTx=false`, this.headers, { useAPIKey: true })
      if (user?.data) {
        const { badge: userBadges, default_currency: defaultCurrency, contacts, theme, locale, permissions } = user.data || {}
        let whiteLabelLocale
        let badgesCompletion = DEFAULT_BADGES_COMPLETION

        // White Label override
        if (storageAvailable('sessionStorage')) {
          let torusWhiteLabel = sessionStorage.getItem('torus-white-label')
          if (torusWhiteLabel) {
            try {
              torusWhiteLabel = JSON.parse(torusWhiteLabel)
              whiteLabelLocale = torusWhiteLabel.defaultLanguage
            } catch (error) {
              log.error(error)
            }
          }
        }

        if (userBadges) {
          try {
            badgesCompletion = JSON.parse(userBadges)
          } catch (error) {
            log.error(error)
          }
        }

        this.store.updateState({
          contacts,
          theme,
          selectedCurrency: defaultCurrency,
          locale: whiteLabelLocale || locale || getUserLanguage(),
          permissions,
          badgesCompletion,
        })
        if (callback) return callback(user)
      }
      return undefined
    } catch (error) {
      log.error(error)
      if (errorCallback) errorCallback()
      return undefined
    } finally {
      Promise.all([
        getWalletOrders({}, this.headers.headers).catch((error) => {
          log.error('unable to fetch wallet orders', error)
        }),
        getPastOrders({}, this.headers.headers).catch((error) => {
          log.error('unable to fetch past orders', error)
        }),
      ])
        .then((data) => {
          const [walletTx, paymentTx] = data
          if (paymentTx?.data) {
            this.calculatePaymentTx(paymentTx.data)
          }
          this.fetchedPastTx = walletTx.data
          this.calculatePastTx(walletTx.data)
        })
        .catch((error) => log.error(error))
    }
  }

  calculatePaymentTx(txs) {
    const accumulator = []
    for (const x of txs) {
      let action = ''
      const lowerCaseAction = x.action.toLowerCase()
      if (ACTIVITY_ACTION_TOPUP.includes(lowerCaseAction)) action = ACTIVITY_ACTION_TOPUP
      else if (ACTIVITY_ACTION_SEND.includes(lowerCaseAction)) action = ACTIVITY_ACTION_SEND
      else if (ACTIVITY_ACTION_RECEIVE.includes(lowerCaseAction)) action = ACTIVITY_ACTION_RECEIVE

      accumulator.push({
        id: x.id,
        date: new Date(x.date),
        from: x.from,
        slicedFrom: x.slicedFrom,
        action,
        to: x.to,
        slicedTo: x.slicedTo,
        totalAmount: x.totalAmount,
        totalAmountString: x.totalAmountString,
        currencyAmount: x.currencyAmount,
        currencyAmountString: x.currencyAmountString,
        amount: x.amount,
        ethRate: x.ethRate,
        status: x.status.toLowerCase(),
        etherscanLink: x.etherscanLink || '',
        currencyUsed: x.currencyUsed,
      })
    }
    this.paymentTxStore.putState(accumulator)
  }

  async calculatePastTx(txs) {
    const pastTx = []
    const pendingTx = []
    const lowerCaseSelectedAddress = this.state.selectedAddress.toLowerCase()
    for (const x of txs) {
      if (
        x.network === this.network.getNetworkNameFromNetworkCode() &&
        (lowerCaseSelectedAddress === x.from.toLowerCase() || lowerCaseSelectedAddress === x.to.toLowerCase())
      ) {
        if (x.status !== 'confirmed') {
          pendingTx.push(x)
        } else {
          const finalObject = formatPastTx(x, lowerCaseSelectedAddress)
          pastTx.push(finalObject)
        }
      }
    }
    const pendingTxPromises = pendingTx.map((x) => getEthTxStatus(x.transaction_hash, this.web3).catch((error) => log.error(error)))
    const resolvedTxStatuses = await Promise.all(pendingTxPromises)
    for (const [index, element] of pendingTx.entries()) {
      const finalObject = formatPastTx(element, lowerCaseSelectedAddress)
      finalObject.status = resolvedTxStatuses[index]
      pastTx.push(finalObject)
      if (lowerCaseSelectedAddress === element.from.toLowerCase() && finalObject.status && finalObject.status !== element.status)
        this.patchPastTx(element.id, finalObject.status)
    }
    this.pastTransactionsStore.putState(pastTx)
  }

  async fetchEtherscanTx() {
    try {
      const { selectedAddress } = this.state
      const tx = await getEtherscanTransactions({ selectedAddress }, this.headers.headers)
      if (tx?.data) {
        this.emit('addEtherscanTransactions', tx.data)
      }
    } catch (error) {
      log.error('unable to fetch etherscan tx', error)
    }
  }

  async patchNewTx(tx) {
    const formattedTx = formatPastTx(tx)
    const storePastTx = this.pastTransactionsStore.getState()
    const duplicateIndex = storePastTx.findIndex((x) => x.transaction_hash === tx.transaction_hash && x.networkType === tx.network)
    if (tx.status === 'submitted' || tx.status === 'confirmed') {
      if (duplicateIndex === -1 && tx.status === 'submitted') {
        // No duplicate found
        this.pastTransactionsStore.putState(storePastTx.concat([formattedTx]))
        this.postPastTx(tx)
        try {
          notifyUser(formattedTx.etherscanLink)
        } catch (error) {
          log.error(error)
        }
      } else {
        storePastTx[duplicateIndex] = formattedTx
        this.pastTransactionsStore.putState([...storePastTx])
      }
    }
  }

  async postPastTx(tx) {
    try {
      const response = await post(`${config.api}/transaction`, tx, this.headers, { useAPIKey: true })
      log.info('successfully added', response)
    } catch (error) {
      log.error(error, 'unable to insert transaction')
    }
  }

  /* istanbul ignore next */
  recalculatePastTx() {
    // This triggers store update which calculates past Tx status for that network
    this.calculatePastTx(this.fetchedPastTx)
  }

  /* istanbul ignore next */
  createUser(selectedCurrency, theme, verifier, verifierId) {
    return post(
      `${config.api}/user`,
      {
        default_currency: selectedCurrency,
        theme,
        verifier,
        verifierId,
      },
      this.headers,
      { useAPIKey: true }
    )
  }

  /* istanbul ignore next */
  storeUserLogin(verifier, verifierId, payload) {
    let userOrigin = ''
    if (payload && payload.calledFromEmbed) {
      userOrigin = getIFrameOrigin()
    } else userOrigin = window.location.origin
    if (!payload.rehydrate) {
      const interval = setInterval(() => {
        const urlParameters = new URLSearchParams(window.location.search)
        const referrer = urlParameters.get('referrer') || ''
        if (window.location.href.includes('referrer') && !referrer) return
        post(
          `${config.api}/user/recordLogin`,
          {
            hostname: userOrigin,
            verifier,
            verifierId,
            metadata: `referrer:${referrer}`,
          },
          this.headers,
          { useAPIKey: true }
        )
        clearInterval(interval)
      }, 1000)
    }
  }

  async setUserTheme(payload) {
    if (payload === this.state.theme) return
    try {
      await patch(`${config.api}/user/theme`, { theme: payload }, this.headers, { useAPIKey: true })
      this.handleSuccess('navBar.snackSuccessTheme')
      this.store.updateState({ theme: payload })
    } catch (error) {
      log.error(error)
      this.handleError('navBar.snackFailTheme')
    }
  }

  /* istanbul ignore next */
  async setPermissions(payload) {
    try {
      const response = await post(`${config.api}/permissions`, payload, this.headers, { useAPIKey: true })
      log.info('successfully set permissions', response)
    } catch (error) {
      log.error('unable to set permissions', error)
    }
  }

  async setUserLocale(payload) {
    if (payload === this.state.locale) return
    try {
      await patch(`${config.api}/user/locale`, { locale: payload }, this.headers, { useAPIKey: true })
      this.store.updateState({ locale: payload })
      // this.handleSuccess('navBar.snackSuccessLocale')
    } catch (error) {
      // this.handleError('navBar.snackFailLocale')
      log.error('unable to set locale', error)
    }
  }

  async setSelectedCurrency(payload) {
    if (payload.selectedCurrency === this.state.selectedCurrency) return
    try {
      await patch(`${config.api}/user`, { default_currency: payload.selectedCurrency }, this.headers, { useAPIKey: true })
      this.store.updateState({ selectedCurrency: payload.selectedCurrency })
      this.handleSuccess('navBar.snackSuccessCurrency')
    } catch (error) {
      log.error(error)
      this.handleError('navBar.snackFailCurrency')
    }
  }

  /* istanbul ignore next */
  async setVerifier(verifier, verifierId) {
    try {
      const response = await patch(`${config.api}/user/verifier`, { verifier, verifierId }, this.headers, { useAPIKey: true })
      log.info('successfully updated verifier info', response)
    } catch (error) {
      log.error('unable to update verifier info', error)
    }
  }

  /* istanbul ignore next */
  getEtherScanTokenBalances() {
    return get(`${config.api}/tokenbalances`, this.headers, { useAPIKey: true })
  }

  async getBillboardContents() {
    try {
      const resp = await get(`${config.api}/billboard`, this.headers, { useAPIKey: true })
      const events = resp.data.reduce((accumulator, event) => {
        if (!accumulator[event.callToActionLink]) accumulator[event.callToActionLink] = {}
        accumulator[event.callToActionLink][event.locale] = event
        return accumulator
      }, {})

      if (events) this.store.updateState({ billboard: events })
    } catch (error) {
      log.error(error)
    }
  }

  async addContact(payload) {
    try {
      const response = await post(`${config.api}/contact`, payload, this.headers, { useAPIKey: true })
      this.store.updateState({ contacts: [...this.state.contacts, response.data] })
      this.handleSuccess('navBar.snackSuccessContactAdd')
    } catch {
      this.handleError('navBar.snackFailContactAdd')
    }
  }

  async deleteContact(payload) {
    try {
      const response = await remove(`${config.api}/contact/${payload}`, {}, this.headers, { useAPIKey: true })
      const finalContacts = this.state.contacts.filter((contact) => contact.id !== response.data.id)
      this.store.updateState({ contacts: finalContacts })
      this.handleSuccess('navBar.snackSuccessContactDelete')
    } catch {
      this.handleError('navBar.snackFailContactDelete')
    }
  }

  /* istanbul ignore next */
  async revokeDiscord(idToken) {
    try {
      const resp = await post(`${config.api}/revoke/discord`, { token: idToken }, this.headers, { useAPIKey: true })
      log.info(resp)
    } catch (error) {
      log.error(error)
    }
  }

  /* istanbul ignore next */
  async patchPastTx(txId, status) {
    try {
      const response = await patch(
        `${config.api}/transaction`,
        {
          id: txId,
          status,
        },
        this.headers,
        { useAPIKey: true }
      )
      log.info('successfully patched', response)
    } catch (error) {
      log.error('unable to patch tx', error)
    }
  }

  setSiteMetadata(origin, domainMetadata) {
    this.metadataStore.updateState({ [origin]: domainMetadata })
  }

  setSelectedAddress(address) {
    if (this.state.selectedAddress === address) return
    this.store.updateState({ selectedAddress: address })
    this.recalculatePastTx()
    this.fetchEtherscanTx()
    // this.sync()
  }

  /**
   * @param {number} interval
   */
  set interval(interval) {
    if (this._handle) clearInterval(this._handle)
    if (!interval) {
      return
    }
    this._handle = setInterval(() => {
      // call here
      if (!this._jwtToken) return
      this.sync()
    }, interval)
  }

  async setUserBadge(payload) {
    const newBadgeCompletion = { ...this.state.badgesCompletion, ...{ [payload]: true } }
    this.store.updateState({ badgesCompletion: newBadgeCompletion })
    try {
      await patch(`${config.api}/user/badge`, { badge: JSON.stringify(newBadgeCompletion) }, this.headers, { useAPIKey: true })
    } catch (error) {
      log.error('unable to set badge', error)
    }
  }
}

export default PreferencesController
