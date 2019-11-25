import { BroadcastChannel } from 'broadcast-channel'
import log from 'loglevel'
import Vue from 'vue'
import Vuex from 'vuex'
import VuexPersistence from 'vuex-persist'
import { fromWei, hexToUtf8, toBN, toChecksumAddress } from 'web3-utils'
import config from '../config'
import torus from '../torus'
import { getEtherScanHashLink, broadcastChannelOptions } from '../utils/utils'
import { post } from '../utils/httpHelpers.js'
import { notifyUser } from '../utils/notifications'
import state from './state'
import actions from './actions'
import paymentActions from './PaymentActions'
import getters from './getters'
import mutations from './mutations'

function getCurrencyMultiplier() {
  const { selectedCurrency, currencyData } = VuexStore.state || {}
  let currencyMultiplier = 1
  if (selectedCurrency !== 'ETH') currencyMultiplier = currencyData[selectedCurrency.toLowerCase()] || 1
  return currencyMultiplier
}

const baseRoute = config.baseRoute

Vue.use(Vuex)

const vuexPersist = new VuexPersistence({
  key: 'torus-app',
  storage: window.sessionStorage,
  reducer: state => {
    return {
      userInfo: state.userInfo,
      userInfoAccess: state.userInfoAccess,
      idToken: state.idToken,
      wallet: state.wallet,
      // weiBalance: state.weiBalance,
      selectedAddress: state.selectedAddress,
      networkType: state.networkType,
      networkId: state.networkId,
      currencyData: state.currencyData,
      // tokenData: state.tokenData,
      tokenRates: state.tokenRates,
      selectedCurrency: state.selectedCurrency,
      jwtToken: state.jwtToken,
      theme: state.theme,
      billboard: state.billboard,
      contacts: state.contacts
      // pastTransactions: state.pastTransactions
    }
  }
})

var VuexStore = new Vuex.Store({
  plugins: [vuexPersist.plugin],
  state,
  getters,
  mutations,
  actions: {
    ...actions,
    ...paymentActions,
    showPopup({ state, getters }, payload) {
      let confirmWindow
      let iClosedConfirmWindow
      let txId
      const bc = new BroadcastChannel(`torus_channel_${torus.instanceId}`, broadcastChannelOptions)
      const isTx = isTorusTransaction()
      const width = 500
      const height = isTx ? 660 : 400
      // const width = 500
      // const height = 600
      confirmWindow = window.open(
        `${baseRoute}confirm?instanceId=${torus.instanceId}&integrity=true`,
        '_blank',
        `directories=0,titlebar=0,toolbar=0,status=0,location=0,menubar=0,height=${height},width=${width}`
      )
      if (isTx) {
        var balance = fromWei(this.state.weiBalance[this.state.selectedAddress].toString())
        var txParams = getters.unApprovedTransactions[getters.unApprovedTransactions.length - 1]
        bc.onmessage = async ev => {
          if (txId !== undefined && txId !== ev.data.id) {
            return // ignore message if txId is different
          }
          if (ev.data === 'popup-loaded' && txId === undefined) {
            txId = txParams.id
            await bc.postMessage({
              data: {
                origin: window.location.ancestorOrigins ? window.location.ancestorOrigins[0] : document.referrer,
                type: 'transaction',
                txParams: { ...txParams, network: state.networkType.host },
                balance
              }
            })
          } else if (ev.data.type === 'confirm-transaction' || ev.data.type === 'deny-transaction') {
            if (ev.data.type === 'confirm-transaction') {
              handleConfirm(ev)
            } else if (ev.data.type === 'deny-transaction') {
              handleDeny(ev.data.id)
            }
            bc.close()
            iClosedConfirmWindow = true
            txId = undefined
            confirmWindow && confirmWindow.close()
          }
        }
      } else {
        var { msgParams, id } = getLatestMessageParams()
        bc.onmessage = async ev => {
          if (txId !== undefined && txId !== ev.data.id) {
            return // ignore message if txId is different
          }
          if (ev.data === 'popup-loaded' && txId === undefined) {
            txId = id
            await bc.postMessage({
              data: {
                origin: window.location.ancestorOrigins ? window.location.ancestorOrigins[0] : document.referrer,
                type: 'message',
                msgParams: { msgParams, id }
              }
            })
          } else if (ev.data.type === 'confirm-transaction' || ev.data.type === 'deny-transaction') {
            if (ev.data.type === 'confirm-transaction') {
              handleConfirm(ev)
            } else if (ev.data.type === 'deny-transaction') {
              handleDeny(ev.data.id)
            }
            bc.close()
            iClosedConfirmWindow = true
            txId = undefined
            confirmWindow && confirmWindow.close()
          }
        }
      }
      var confirmTimer = setInterval(function() {
        if (confirmWindow.closed) {
          clearInterval(confirmTimer)
          if (!iClosedConfirmWindow) {
            log.error('user closed popup')
            handleDeny(txId)
          }
          bc.close()
          txId = undefined
          iClosedConfirmWindow = false
          confirmWindow = undefined
        }
      }, 1000)
    }
  }
})

function handleConfirm(ev) {
  let { torusController } = torus
  let state = VuexStore.state
  if (Object.keys(state.unapprovedPersonalMsgs).length > 0) {
    let msgParams = state.unapprovedPersonalMsgs[ev.data.id].msgParams
    log.info('PERSONAL MSG PARAMS:', msgParams)
    msgParams.metamaskId = parseInt(ev.data.id, 10)
    torusController.signPersonalMessage(msgParams)
  } else if (Object.keys(state.unapprovedMsgs).length > 0) {
    let msgParams = state.unapprovedMsgs[ev.data.id].msgParams
    log.info(' MSG PARAMS:', msgParams)
    msgParams.metamaskId = parseInt(ev.data.id, 10)
    torusController.signMessage(msgParams)
  } else if (Object.keys(state.unapprovedTypedMessages).length > 0) {
    let msgParams = state.unapprovedTypedMessages[ev.data.id].msgParams
    log.info('TYPED MSG PARAMS:', msgParams)
    msgParams.metamaskId = parseInt(ev.data.id, 10)
    torusController.signTypedMessage(msgParams)
  } else if (Object.keys(state.transactions).length > 0) {
    const unApprovedTransactions = VuexStore.getters.unApprovedTransactions
    var txMeta = unApprovedTransactions.find(x => x.id === ev.data.id)
    log.info('STANDARD TX PARAMS:', txMeta)

    if (ev.data.gasPrice) {
      log.info('Changed gas price to:', ev.data.gasPrice)
      var newTxMeta = JSON.parse(JSON.stringify(txMeta))
      newTxMeta.txParams.gasPrice = ev.data.gasPrice
      torusController.txController.updateTransaction(newTxMeta)
      txMeta = newTxMeta
      log.info('New txMeta: ', txMeta)
    }
    torusController.updateAndApproveTransaction(txMeta)
  } else {
    throw new Error('No new transactions.')
  }
}

function handleDeny(id) {
  let { torusController } = torus
  let state = VuexStore.state
  if (Object.keys(state.unapprovedPersonalMsgs).length > 0) {
    torusController.cancelPersonalMessage(parseInt(id, 10))
  } else if (Object.keys(state.unapprovedMsgs).length > 0) {
    torusController.cancelMessage(parseInt(id, 10))
  } else if (Object.keys(state.unapprovedTypedMessages).length > 0) {
    torusController.cancelTypedMessage(parseInt(id, 10))
  } else if (Object.keys(state.transactions).length > 0) {
    torusController.cancelTransaction(parseInt(id, 10))
  }
}

function getLatestMessageParams() {
  let time = 0
  let msg = null
  let finalId = 0
  for (let id in VuexStore.state.unapprovedMsgs) {
    const msgTime = VuexStore.state.unapprovedMsgs[id].time
    if (msgTime > time) {
      msg = VuexStore.state.unapprovedMsgs[id]
      time = msgTime
      finalId = id
    }
  }

  for (let id in VuexStore.state.unapprovedPersonalMsgs) {
    const msgTime = VuexStore.state.unapprovedPersonalMsgs[id].time
    if (msgTime > time) {
      msg = VuexStore.state.unapprovedPersonalMsgs[id]
      time = msgTime
      finalId = id
    }
  }

  // handle hex-based messages and convert to text
  if (msg) {
    let finalMsg
    try {
      finalMsg = hexToUtf8(msg.msgParams.data)
    } catch (error) {
      finalMsg = msg.msgParams.data
    }
    msg.msgParams.message = finalMsg
  }

  // handle typed messages
  for (let id in VuexStore.state.unapprovedTypedMessages) {
    const msgTime = VuexStore.state.unapprovedTypedMessages[id].time
    if (msgTime > time) {
      time = msgTime
      msg = VuexStore.state.unapprovedTypedMessages[id]
      msg.msgParams.typedMessages = msg.msgParams.data // TODO: use for differentiating msgs later on
      finalId = id
    }
  }
  return msg ? { msgParams: msg.msgParams, id: finalId } : {}
}

function isTorusTransaction() {
  if (Object.keys(VuexStore.state.unapprovedPersonalMsgs).length > 0) {
    return false
  } else if (Object.keys(VuexStore.state.unapprovedMsgs).length > 0) {
    return false
  } else if (Object.keys(VuexStore.state.unapprovedTypedMessages).length > 0) {
    return false
  } else if (VuexStore.getters.unApprovedTransactions.length > 0) {
    return true
  } else {
    throw new Error('No new transactions.')
  }
}

VuexStore.subscribe((mutation, state) => {
  // will rewrite later
  if (mutation.type === 'setTransactions' && state.jwtToken) {
    const txs = mutation.payload
    for (let id in txs) {
      const txMeta = txs[id]
      if (txMeta.status === 'submitted' && id >= 0) {
        // insert into db here

        const txHash = txMeta.hash

        const totalAmount = fromWei(toBN(txMeta.txParams.value).add(toBN(txMeta.txParams.gas).mul(toBN(txMeta.txParams.gasPrice))))
        const txObj = {
          created_at: new Date(txMeta.time),
          from: toChecksumAddress(txMeta.txParams.from),
          to: toChecksumAddress(txMeta.txParams.to),
          total_amount: totalAmount,
          currency_amount: (getCurrencyMultiplier() * totalAmount).toString(),
          selected_currency: state.selectedCurrency,
          status: 'submitted',
          network: state.networkType.host,
          transaction_hash: txMeta.hash
        }
        if (state.pastTransactions.findIndex(x => x.transaction_hash === txObj.transaction_hash && x.network === txObj.network) === -1) {
          // User notification
          notifyUser(getEtherScanHashLink(txHash, state.networkType.host))

          post(`${config.api}/transaction`, txObj, {
            headers: {
              Authorization: `Bearer ${state.jwtToken}`,
              'Content-Type': 'application/json; charset=utf-8'
            }
          })
            .then(response => {
              if (response.response.length > 0) VuexStore.commit('patchPastTransactions', { ...txObj, id: response.response[0] })
              log.info('successfully added', response)
            })
            .catch(err => log.error(err, 'unable to insert transaction'))
        }
      }
    }
  }
})

export default VuexStore
