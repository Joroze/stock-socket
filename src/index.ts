import dotenv from 'dotenv'
import Websocket from 'ws'
import axios from 'axios'
import lodash from 'lodash'

dotenv.config()

if (process.env.FINNHUB_HOST === undefined) {
  console.log('ERROR: FINNHUB_HOST environment variable not set')
  process.exit(1)
}

if (process.env.HUE_BRIDGE_HOST === undefined) {
  console.log('ERROR: HUE_BRIDGE_HOST environment variable not set')
  process.exit(1)
}

if (process.argv.length < 4) {
  console.error('ERROR: Missing arguments: TICKER and PRICE')
  process.exit()
}

const TICKER_SYMBOL = process.argv[2].toUpperCase()
const TICKER_ALERT_PRICE = Number(process.argv[3])
const ws = new Websocket(process.env.FINNHUB_HOST)

console.log(`Input [${TICKER_SYMBOL}] price: ${TICKER_ALERT_PRICE}`)

let priceAboveFlag = false
let count = 0

// The function below does the grunt work of creating an xy pair that produces
// colours equivalent to RGB colours.
function getXY (red: number, green: number, blue: number) {
  if (red > 0.04045) {
    red = Math.pow((red + 0.055) / (1.0 + 0.055), 2.4)
  } else red /= 12.92

  if (green > 0.04045) {
    green = Math.pow((green + 0.055) / (1.0 + 0.055), 2.4)
  } else green /= 12.92

  if (blue > 0.04045) {
    blue = Math.pow((blue + 0.055) / (1.0 + 0.055), 2.4)
  } else blue /= 12.92

  const X = red * 0.664511 + green * 0.154324 + blue * 0.162028
  const Y = red * 0.283881 + green * 0.668433 + blue * 0.047685
  const Z = red * 0.000088 + green * 0.072310 + blue * 0.986039
  const x = X / (X + Y + Z)
  const y = Y / (X + Y + Z)
  return [x, y]
}

async function emitHueColor (r: number, g: number, b: number) {
  // set RGB values and divide by 255 to convert to a number less than 1;
  // the setting below will set the bulbs to blue. Change the numerator on each line
  // to alter the colour the bulbs are set to.
  // below code will set the bulbs to be blue
  const red = r / 255
  const green = g / 255
  const blue = b / 255

  // get Philips Hue x,y values as an array
  const aXY = getXY(red, green, blue)

  try {
    console.log('Contacting Hue bulb')

    // prepare to POST to Hue
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    await axios.put(`${process.env.HUE_BRIDGE_HOST}/lights/1/state`, { on: true, bri: 254, xy: [aXY[0], aXY[1]] })
  } catch (error) {
    console.log('ERROR: Could not reach Hue bulb')
  }
}

async function dispatchAlert (pFlag: boolean) {
  if (pFlag) {
    return await emitHueColor(0, 255, 0)
  }

  return await emitHueColor(255, 0, 0)
}

const debouncedDispatchAlert = lodash.debounce(dispatchAlert, 5000)
const debouncedOnMessage = lodash.debounce((response: string) => {
  const { data = [] } = JSON.parse(response) as { data: Array<{ p?: number }> }
  const latestPrice = data[0]?.p ?? undefined

  if (count > 100000) {
    count = 1
  }

  count += 1

  console.log('Latest ticker price: ', latestPrice)

  if (latestPrice === undefined) { return }

  if (latestPrice > TICKER_ALERT_PRICE) {
    if (count === 1) {
      dispatchAlert(true)
    }

    if (!priceAboveFlag) {
      priceAboveFlag = true
      debouncedDispatchAlert(true)
    }
  } else if (latestPrice < TICKER_ALERT_PRICE) {
    if (count === 1) {
      dispatchAlert(false)
    }

    if (priceAboveFlag) {
      priceAboveFlag = false
      debouncedDispatchAlert(false)
    }
  }
}, 1000)

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'subscribe', symbol: TICKER_SYMBOL }))
})

ws.on('message', debouncedOnMessage)
