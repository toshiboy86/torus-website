const ROPSTEN = 'ropsten'
const RINKEBY = 'rinkeby'
const KOVAN = 'kovan'
const MAINNET = 'mainnet'
const LOCALHOST = 'localhost'
const GOERLI = 'goerli'
const RPC = 'rpc'

const MAINNET_CODE = 1
const ROPSTEN_CODE = 3
const RINKEYBY_CODE = 4
const KOVAN_CODE = 42
const GOERLI_CODE = 5

const ROPSTEN_DISPLAY_NAME = 'Ropsten Test Network'
const RINKEBY_DISPLAY_NAME = 'Rinkeby Test Network'
const KOVAN_DISPLAY_NAME = 'Kovan Test Network'
const MAINNET_DISPLAY_NAME = 'Main Ethereum Network'
const GOERLI_DISPLAY_NAME = 'Goerli Test Network'
const RPC_DISPLAY_NAME = 'RPC'
const LOCALHOST_DISPLAY_NAME = 'localhost:8545'

const TRANSACTION_TYPE_CANCEL = 'cancel'
const TRANSACTION_TYPE_RETRY = 'retry'
const TRANSACTION_TYPE_STANDARD = 'standard'

const TRANSACTION_STATUS_APPROVED = 'approved'
const TRANSACTION_STATUS_CONFIRMED = 'confirmed'

const TOKEN_METHOD_TRANSFER = 'transfer'
const TOKEN_METHOD_APPROVE = 'approve'
const TOKEN_METHOD_TRANSFER_FROM = 'transferfrom'

const SEND_ETHER_ACTION_KEY = 'sentEther'
const DEPLOY_CONTRACT_ACTION_KEY = 'contractDeployment'
const CONTRACT_INTERACTION_KEY = 'contractInteraction'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

module.exports = {
  ROPSTEN,
  RINKEBY,
  KOVAN,
  MAINNET,
  LOCALHOST,
  GOERLI,
  RPC,
  MAINNET_CODE,
  ROPSTEN_CODE,
  RINKEYBY_CODE,
  GOERLI_CODE,
  KOVAN_CODE,
  ROPSTEN_DISPLAY_NAME,
  RINKEBY_DISPLAY_NAME,
  KOVAN_DISPLAY_NAME,
  MAINNET_DISPLAY_NAME,
  GOERLI_DISPLAY_NAME,
  RPC_DISPLAY_NAME,
  LOCALHOST_DISPLAY_NAME,
  TRANSACTION_TYPE_CANCEL,
  TRANSACTION_TYPE_RETRY,
  TRANSACTION_TYPE_STANDARD,
  TRANSACTION_STATUS_APPROVED,
  TRANSACTION_STATUS_CONFIRMED,
  ZERO_ADDRESS,
  TOKEN_METHOD_APPROVE,
  TOKEN_METHOD_TRANSFER,
  TOKEN_METHOD_TRANSFER_FROM,
  SEND_ETHER_ACTION_KEY,
  DEPLOY_CONTRACT_ACTION_KEY,
  CONTRACT_INTERACTION_KEY
}
