import { DataSubmissionPageFactory, ScriptHostComponent } from "@eyra/feldspar";
import { HelloWorldFactory } from "./components/hello_world";
import { CategoryFactory } from "./components/category";
import { installDemoHost } from "./host/demo_host";
import jsWorkerUrl from "./js_worker/worker.ts?worker&url";
import tiktokWorkerUrl from "./js_worker/tiktok_worker.ts?worker&url";

// Donation flows on the JavaScript runtime, by platform. A host page embeds the app as
// `.../index.html?platform=<name>`; without the parameter, VITE_WORKER picks one at build time
// (`js` is the demo flow), and with neither it is upstream's Python demo.
const workers: Record<string, string> = { js: jsWorkerUrl, tiktok: tiktokWorkerUrl };
const requested = new URLSearchParams(window.location.search).get("platform");
const workerUrl = requested !== null ? workers[requested] : workers[import.meta.env.VITE_WORKER ?? ""] ?? "./py_worker.js";

// VITE_DEMO_HOST=1 plays the host page itself, with a fake donation upload (see host/demo_host.ts).
// Imported always (it is small and inert otherwise) so it is listening before the app announces itself.
if (import.meta.env.VITE_DEMO_HOST === "1") installDemoHost();

function App() {
  if (workerUrl === undefined) {
    return <p className="p-8 font-body text-bodylarge">This data donation isn’t available.</p>;
  }
  return (
    <div className="App">
      <ScriptHostComponent
        workerUrl={workerUrl}
        standalone={import.meta.env.DEV}
        factories={[
          new DataSubmissionPageFactory({
            promptFactories: [new HelloWorldFactory(), new CategoryFactory()],
          }),
        ]}
        logLevel={import.meta.env.DEV ? "debug" : "info"}
      />
      {/* AGPL-3.0 §13: people using this over a network are offered its source. */}
      <footer className="px-4 pb-4 sm:px-6 text-right font-body text-caption text-grey2">
        This donation tool is open source (AGPL-3.0):{" "}
        <a className="btn-focus underline text-primary" href="https://github.com/digital-kaleidoscope/feldspar" target="_blank" rel="noopener noreferrer">
          source code<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </footer>
    </div>
  );
}

export default App;
