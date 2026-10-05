// Worker entry point: the TikTok donation flow on the JavaScript runtime.
import { runScript } from './runtime'
import { process } from './tiktok/script'

runScript(process)
