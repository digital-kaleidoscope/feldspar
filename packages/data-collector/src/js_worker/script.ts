// Port of packages/python/port/script.py: the same demo donation flow, step for step,
// producing the same pages and tables. Kept deliberately parallel to the Python so the
// two can be compared (and so tests/memory-benchmark.cjs runs unchanged against it).

import { DataFrame, type Cell } from './port/data_frame'
import * as props from './port/props'
import type { Command, Payload, ScriptContext } from './port/props'
import { SafeData } from './port/safe_data'
import { Zip } from './port/zip'
import { logger } from './runtime'

interface ExtractionResult {
  name: string
  dataFrame: DataFrame
  columnWidths?: Record<string, number>
}

type Flow<T = void> = AsyncGenerator<Command, T, Payload>

/// ///////////////////
// Data donation flow //
/// ///////////////////

export async function * process ({ sessionId, locale = 'en' }: ScriptContext): Flow {
  logger.info(`user entered script (locale=${locale})`)
  const key = 'zip-contents-example'

  let results: ExtractionResult[] | null = null

  while (true) {
    const fileResult = yield * step1SelectFile(key)
    if (fileResult === null) break

    const [extracted, retry] = yield * step2ExtractDataFromFile(key, fileResult, locale)
    results = extracted
    if (retry) continue
    break
  }

  if (results !== null) {
    yield * step3Consent(key, sessionId, results)
  }
}

async function * step1SelectFile (key: string): Flow<File | null> {
  logger.debug(`${key}: prompt file`)
  const fileResult = yield renderDataSubmissionPage([promptFile('application/zip, text/plain')])
  if (fileResult.__type__ !== 'PayloadFile') {
    logger.debug(`${key}: no file selected, exit`)
    return null
  }
  return fileResult.value
}

async function * step2ExtractDataFromFile (key: string, file: File, locale: string): Flow<[ExtractionResult[] | null, boolean]> {
  logger.debug(`${key}: extracting file`)
  let zip: Zip | null = null
  try {
    // Opening or reading a damaged or non-zip file rejects, like zipfile's BadZipFile.
    zip = await Zip.open(file)
    const results = await extractData(zip, locale)
    logger.debug(`${key}: extraction successful, go to consent form`)
    return [results, false]
  } catch (error) {
    logger.warn(`${key}: could not process file: ${String(error)}`)
  } finally {
    await zip?.close()
  }
  logger.debug(`${key}: prompt confirmation to retry file selection`)
  const retryResult = yield renderDataSubmissionPage(retryConfirmation())
  if (retryResult.__type__ === 'PayloadTrue') return [null, true]
  logger.debug(`${key}: user declined retry, exit`)
  return [null, false]
}

async function * step3Consent (key: string, sessionId: string, results: ExtractionResult[]): Flow {
  logger.debug(`${key}: prompt consent`)
  const result = yield promptConsent(results)
  if (result.__type__ === 'PayloadJSON') {
    logger.debug(`${key}: donate consent data`)
    yield donate(`${sessionId}-${key}`, result.value)
  }
  if (result.__type__ === 'PayloadFalse') {
    const value = JSON.stringify('{"status" : "data_submission declined"}')
    yield donate(`${sessionId}-${key}`, value)
  }
}

/// ///////////////////
// Zip file processing //
/// ///////////////////

async function extractData (zip: Zip, locale = 'en'): Promise<ExtractionResult[]> {
  logger.info(`extract_data: zip opened, ${zip.namelist().length} files`)
  const extractors: Array<[string, () => Promise<ExtractionResult> | ExtractionResult]> = [
    ['file inventory', async () => await extractFileInventory(zip, locale)],
    ['file types', () => extractFileTypes(zip)],
    ['largest files', () => extractLargestFiles(zip)],
    ['json summary', async () => await extractJsonSummary(zip)]
  ]
  const results: ExtractionResult[] = []
  for (const [name, fn] of extractors) {
    logger.debug(`extract_data: extracting ${name}...`)
    try {
      results.push(await fn())
      logger.info(`extract_data: ${name} extracted successfully`)
    } catch (error) {
      logger.error(`extract_data: failed to extract ${name}: ${String(error)}`)
      throw error
    }
  }
  logger.info(`extract_data: done, ${results.length} tables extracted`)
  return results
}

const FILE_INVENTORY_HEADERS: Record<string, [string, string, string]> = {
  en: ['Filename', 'Compressed size', 'Size'],
  de: ['Dateiname', 'Komprimierte Größe', 'Größe'],
  it: ['Nome file', 'Dimensione compressa', 'Dimensione'],
  es: ['Nombre de archivo', 'Tamaño comprimido', 'Tamaño'],
  nl: ['Bestandsnaam', 'Gecomprimeerde grootte', 'Grootte'],
  ro: ['Nume fișier', 'Dimensiune comprimată', 'Dimensiune'],
  lt: ['Failo pavadinimas', 'Suspaustas dydis', 'Dydis']
}

const sleep = async (ms: number): Promise<void> => await new Promise((resolve) => setTimeout(resolve, ms))

// List every file in the zip with its compressed and uncompressed size, under localized headers.
async function extractFileInventory (zip: Zip, locale = 'en'): Promise<ExtractionResult> {
  const headers = FILE_INVENTORY_HEADERS[locale] ?? FILE_INVENTORY_HEADERS.en
  const [filenameCol, compressedCol, sizeCol] = headers
  const rows: Array<Record<string, Cell>> = []
  for (const info of zip.infolist()) {
    await sleep(10) // artificial delay, mirrors the Python demo; remove in production
    rows.push({ [filenameCol]: info.filename, [compressedCol]: info.compressedSize, [sizeCol]: info.size })
  }
  // The filename gets three times the desktop width of each size column.
  return { name: 'file_inventory', dataFrame: new DataFrame(rows, headers), columnWidths: { [filenameCol]: 3 } }
}

// Python's os.path.splitext(name)[1]: the last dot of the basename, ignoring leading dots.
function extension (name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 && base.slice(0, dot).replace(/^\.+/, '') !== '' ? base.slice(dot) : ''
}

// Count files grouped by extension.
function extractFileTypes (zip: Zip): ExtractionResult {
  const counts = new Map<string, number>()
  for (const name of zip.namelist()) {
    const ext = extension(name).toLowerCase() || '(none)'
    counts.set(ext, (counts.get(ext) ?? 0) + 1)
  }
  const rows = [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([ext, count]) => ({ Extension: ext, Count: count }))
  return { name: 'file_types', dataFrame: new DataFrame(rows, ['Extension', 'Count']) }
}

// Show the top N files by uncompressed size.
function extractLargestFiles (zip: Zip, n = 10): ExtractionResult {
  const files = zip.infolist().sort((a, b) => b.size - a.size).slice(0, n)
  const rows = files.map((i) => ({ Filename: i.filename, Size: i.size }))
  return { name: 'largest_files', dataFrame: new DataFrame(rows, ['Filename', 'Size']) }
}

// Summarise every .json file in the zip using SafeData: typed getters with defaults,
// candidate paths for fields that move between export versions, and hadErrors() to flag
// files whose data was not fully clean.
async function extractJsonSummary (zip: Zip): Promise<ExtractionResult> {
  const rows: Array<Record<string, Cell>> = []
  for (const name of zip.namelist()) {
    if (!name.toLowerCase().endsWith('.json')) continue
    const data = SafeData.parseJson(await zip.readText(name))
    const items = data.getListOf('SafeData', 'items')
    rows.push({
      Filename: name,
      User: data.getStr(['user.name', 'user.displayName', 'account.fullName'], '(unknown)'),
      'User ID': data.getInt(['user.id', 'user.userId'], 0),
      'Item count': items.length,
      Errors: data.hadErrors() ? 'yes' : 'no'
    })
  }
  return { name: 'json_summary', dataFrame: new DataFrame(rows, ['Filename', 'User', 'User ID', 'Item count', 'Errors']) }
}

/// ///////////
// UI helpers //
/// ///////////

function renderDataSubmissionPage (body: object | object[]): Command {
  const header = props.header(props.translatable({
    en: 'Data donation flow example',
    de: 'Beispiel für einen Datenspende-Ablauf',
    it: 'Esempio di flusso di donazione dei dati',
    es: 'Ejemplo de flujo de donación de datos',
    nl: 'Voorbeeld van een datadonatieproces',
    ro: 'Exemplu de flux de donație a datelor',
    lt: 'Duomenų dovanojimo srauto pavyzdys'
  }))
  return props.render(props.pageDataSubmission('Zip', header, body))
}

function retryConfirmation (): object {
  const text = props.translatable({
    en: 'Unfortunately, we cannot process your file. Continue, if you are sure that you selected the right file. Try again to select a different file.',
    de: 'Leider können wir Ihre Datei nicht bearbeiten. Fahren Sie fort, wenn Sie sicher sind, dass Sie die richtige Datei ausgewählt haben. Versuchen Sie, eine andere Datei auszuwählen.',
    it: 'Purtroppo non possiamo elaborare il tuo file. Continua se sei sicuro di aver selezionato il file corretto. Prova a selezionare un file diverso.',
    es: 'Lamentablemente, no podemos procesar su archivo. Continúe si está seguro de que ha seleccionado el archivo correcto. Intente seleccionar un archivo diferente.',
    nl: 'Helaas, kunnen we uw bestand niet verwerken. Weet u zeker dat u het juiste bestand heeft gekozen? Ga dan verder. Probeer opnieuw als u een ander bestand wilt kiezen.',
    ro: 'Din păcate, nu putem procesa fișierul dvs. Continuați dacă sunteți sigur că ați selectat fișierul corect. Încercați din nou pentru a selecta un fișier diferit.',
    lt: 'Deja, negalime apdoroti jūsų failo. Tęskite, jei esate tikri, kad pasirinkote tinkamą failą. Bandykite dar kartą pasirinkti kitą failą.'
  })
  const ok = props.translatable({
    en: 'Try again',
    de: 'Erneut versuchen',
    it: 'Riprova',
    es: 'Inténtelo de nuevo',
    nl: 'Probeer opnieuw',
    ro: 'Încercați din nou',
    lt: 'Bandykite dar kartą'
  })
  return props.promptConfirm(text, ok)
}

function promptFile (extensions: string): object {
  const description = props.translatable({
    en: 'Please select a zip file stored on your device.',
    de: 'Bitte wählen Sie eine ZIP-Datei auf Ihrem Gerät aus.',
    it: 'Seleziona un file ZIP memorizzato sul tuo dispositivo.',
    es: 'Por favor, seleccione un archivo ZIP guardado en su dispositivo.',
    nl: 'Selecteer een ZIP-bestand dat op uw apparaat is opgeslagen.',
    ro: 'Vă rugăm să selectați un fișier ZIP stocat pe dispozitivul dvs.',
    lt: 'Prašome pasirinkti ZIP failą, saugomą jūsų įrenginyje.'
  })
  return props.promptFileInput(description, extensions)
}

const titleCase = (s: string): string => s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())

function promptConsent (data: ExtractionResult[]): Command {
  const description = props.promptText(props.translatable({
    en: 'Please review the data below. You can remove any information you prefer not to share. Thank you for supporting this research project!',
    de: 'Bitte überprüfen Sie Ihre Daten unten. Sie können alle Daten entfernen, die Sie nicht teilen möchten. Vielen Dank für Ihre Unterstützung dieses Forschungsprojekts!',
    it: 'Controlla i tuoi dati qui sotto. Puoi rimuovere qualsiasi dato che preferisci non condividere. Grazie per il tuo supporto a questo progetto di ricerca!',
    es: 'Revise sus datos a continuación. Puede eliminar cualquier dato que prefiera no compartir. ¡Gracias por apoyar este proyecto de investigación!',
    nl: 'Bekijk hieronder uw gegevens. U kunt gegevens verwijderen die u liever niet deelt. Bedankt voor uw steun aan dit onderzoeksproject!',
    ro: 'Vă rugăm să revizuiți datele de mai jos. Puteți elimina orice date pe care preferați să nu le partajați. Vă mulțumim că sprijiniți acest proiect de cercetare!',
    lt: 'Prašome peržiūrėti savo duomenis žemiau. Galite pašalinti bet kokius duomenis, kurių nenorite bendrinti. Ačiū, kad remiate šį tyrimų projektą!'
  }))

  // Tables derived from the uploaded zip file
  const tables = data.map((result, i) => {
    const title = titleCase(result.name.replace(/_/g, ' '))
    return props.consentFormTable(result.name, i + 1, props.translatable({ en: title, nl: title }), result.dataFrame, {
      description: props.translatable({ en: `Overview of ${result.name.replace(/_/g, ' ')} from your zip file.` }),
      columnWidths: result.columnWidths
    })
  })

  // A static table with hardcoded data, e.g. for reference data that does not come from
  // the uploaded file. No description; `headers` only set the labels participants see
  // (donated rows keep the column names); `columnWidths` are relative weights.
  const staticTable = props.consentFormTable(
    'zip_content',
    data.length + 1,
    props.translatable({
      en: 'Example Metadata Table',
      de: 'Beispieltabelle für Metadaten',
      it: 'Tabella di metadati di esempio',
      es: 'Tabla de metadatos de ejemplo',
      nl: 'Voorbeeld van metagegevens tabel',
      ro: 'Tabel de metadate de exemplu',
      lt: 'Metaduomenų lentelės pavyzdys'
    }),
    new DataFrame([
      ['participant-001', 'Device A', '2025-06-01', 'Morning session\nQuiet room\n\nNo issues'],
      [
        'participant-002',
        'Device B',
        '2025-06-02',
        'Short break.\n\nThe participant asked how their data would be stored and who could ' +
        'access it. We explained the consent form again, walked through each table on this ' +
        'page, and showed how to remove rows before donating. They chose to continue after ' +
        'reading the full privacy statement and asked for a copy by email.\n\n' +
        'Session completed without further questions.'
      ],
      ['participant-003', 'Device C', '2025-06-03', 'Completed\nwithout remarks']
    ], ['participant_id', 'device', 'date', 'notes']),
    {
      dataFrameMaxSize: 5000,
      headers: {
        participant_id: props.translatable({ en: 'Participant ID', de: 'Teilnehmer-ID', it: 'ID partecipante', es: 'ID del participante', nl: 'Deelnemer-ID', ro: 'ID participant', lt: 'Dalyvio ID' }),
        device: props.translatable({ en: 'Device', de: 'Gerät', it: 'Dispositivo', es: 'Dispositivo', nl: 'Apparaat', ro: 'Dispozitiv', lt: 'Įrenginys' }),
        date: props.translatable({ en: 'Date', de: 'Datum', it: 'Data', es: 'Fecha', nl: 'Datum', ro: 'Dată', lt: 'Data' }),
        notes: props.translatable({ en: 'Notes', de: 'Notizen', it: 'Note', es: 'Notas', nl: 'Notities', ro: 'Note', lt: 'Pastabos' })
      },
      columnWidths: { participant_id: 2, notes: 3 }
    }
  )

  const buttons = props.dataSubmissionButtons(
    props.translatable({
      en: 'Would you like to donate the above data?',
      de: 'Möchten Sie die obenstehenden Daten spenden?',
      it: 'Vuoi donare i dati sopra indicati?',
      es: '¿Le gustaría donar los datos anteriores?',
      nl: 'Wilt u de bovenstaande gegevens doneren?',
      ro: 'Doriți să donați datele de mai sus?',
      lt: 'Ar norėtumėte paaukoti aukščiau pateiktus duomenis?'
    }),
    props.translatable({
      en: 'Yes, donate',
      de: 'Ja, spenden',
      it: 'Sì, dona',
      es: 'Sí, donar',
      nl: 'Ja, doneer',
      ro: 'Da, donez',
      lt: 'Taip, paaukokite'
    })
  )

  return renderDataSubmissionPage([description, ...tables, staticTable, buttons])
}

function donate (key: string, jsonString: string): Command {
  return props.donate(key, jsonString)
}
