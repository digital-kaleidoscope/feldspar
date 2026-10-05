// TikTok donation flow: pick the export (the JSON itself or a zip of it), read and extract
// it with progress, then a consent page of category cards. The participant's choices come
// back from the page, and the donation is sent in pieces from the worker's own copy.

import type { Category } from '../port/category'
import { readJson } from '../port/files'
import { track } from '../port/progress'
import * as props from '../port/props'
import type { Command, Payload, ScriptContext, Translatable } from '../port/props'
import { RowChannel } from '../port/row_channel'
import { uploadDonation } from '../port/upload'
import { logger } from '../runtime'
import { READ_OPTIONS, extractAll } from './extract'

type Flow<T = void> = AsyncGenerator<Command, T, Payload>
const t = props.translatable

// Recorded in each donation's manifest. Bump when extraction changes what is produced.
const SCRIPT = 'tiktok/0.1-placeholder-fields'

// The participant is identified by the host from their login, never by anything sent here.
export async function * process (_context: ScriptContext): Flow {
  let categories: Category[] | null = null

  while (categories === null) {
    const fileResult = yield page(props.promptFileInput(
      t({ en: 'Please select your TikTok data export (the .json file, or the .zip it came in).', nl: 'Selecteer je TikTok-data-export (het .json-bestand, of het .zip-bestand waarin het zat).' }),
      'application/json, application/zip, .json, .zip'
    ))
    if (fileResult.__type__ !== 'PayloadFile') return

    try {
      categories = yield * readAndExtract(fileResult.value)
    } catch (error) {
      logger.warn(`tiktok: could not process file: ${String(error)}`)
      const retry = yield page(props.promptConfirm(
        t({ en: 'Unfortunately, we could not read this file. Please check that it is your TikTok data export in JSON format.', nl: 'Helaas konden we dit bestand niet lezen. Controleer of het je TikTok-data-export in JSON-formaat is.' }),
        t({ en: 'Try again', nl: 'Probeer opnieuw' })
      ))
      if (retry.__type__ !== 'PayloadTrue') return
    }
  }

  const channel = new RowChannel(categories)
  let result: Payload
  try {
    result = yield consentPage(categories, channel.name)
  } finally {
    channel.close()
  }
  // Declining sends nothing at all, not even a record that the participant declined.
  if (result.__type__ !== 'PayloadJSON') return

  const sent = yield * uploadDonation(categories, result.value, { platform: 'tiktok', script: SCRIPT }, {
    progress: (percent) => page(progress(t({ en: 'Sending your donation…', nl: 'Je donatie wordt verstuurd…' }), percent)),
    failed: () => page(props.promptConfirm(
      t({ en: 'We could not send your donation. Please check your internet connection and try again.', nl: 'We konden je donatie niet versturen. Controleer je internetverbinding en probeer het opnieuw.' }),
      t({ en: 'Try again', nl: 'Probeer opnieuw' })
    ))
  })
  if (sent) {
    yield page(props.promptText(t({ en: 'Thank you! Your donation has been received.', nl: 'Bedankt! Je donatie is ontvangen.' })))
  }
}

async function * readAndExtract (file: File): Flow<Category[]> {
  const reading = t({ en: 'Reading your file…', nl: 'Je bestand wordt gelezen…' })
  const parsed = yield * track(
    async (report) => await readJson(file, { pick: (name) => /\.json$/i.test(name) && !name.startsWith('__MACOSX/'), ...READ_OPTIONS }, report),
    (percent) => page(progress(reading, percent))
  )
  const root = parsed.data.raw()
  if (typeof root !== 'object' || root === null || Array.isArray(root)) throw new Error('Not a JSON object')

  yield page(progress(t({ en: 'Processing your file…', nl: 'Je bestand wordt verwerkt…' })))
  const categories = await extractAll(parsed)
  for (const category of categories) logger.info(`tiktok: ${category.id}: ${category.rows.length} rows`)
  if (categories.every((category) => category.rows.length === 0)) {
    throw new Error('Nothing recognisable: probably not a TikTok export')
  }
  return categories
}

function consentPage (categories: Category[], channel: string): Command {
  return page([
    props.promptText(t({
      en: 'Below is a summary of each kind of data we would like you to donate, with a few example entries. You can leave out any kind entirely, or look through all of its entries and remove individual ones. Nothing is shared until you click the button at the bottom.',
      nl: 'Hieronder zie je per soort gegevens die we je vragen te doneren een samenvatting, met enkele voorbeelden. Je kunt elke soort volledig weglaten, of alle regels bekijken en losse regels verwijderen. Er wordt niets gedeeld totdat je onderaan op de knop klikt.'
    })),
    ...categories.map((category) => props.categoryCard(category, channel)),
    props.dataSubmissionButtons(
      t({ en: 'Would you like to donate the data above?', nl: 'Wil je de bovenstaande gegevens doneren?' }),
      t({ en: 'Yes, donate', nl: 'Ja, doneer' })
    )
  ])
}

function progress (description: Translatable, percent?: number): object {
  return props.promptProgress(description, percent === undefined ? '' : `${percent}%`, percent)
}

function page (body: object | object[]): Command {
  return props.render(props.pageDataSubmission('TikTok', props.header(t({ en: 'Donate your TikTok data', nl: 'Doneer je TikTok-gegevens' })), body))
}
