import { DataSubmissionPageFactory, ScriptHostComponent } from "@eyra/feldspar";
import { HelloWorldFactory } from "./components/hello_world";
import { CategoryFactory } from "./components/category";
import { installDemoHost } from "./host/demo_host";
import jsWorkerUrl from "./js_worker/worker.ts?worker&url";
import tiktokWorkerUrl from "./js_worker/tiktok_worker.ts?worker&url";

// VITE_WORKER=js builds the demo flow on the JavaScript runtime instead of Pyodide;
// VITE_WORKER=tiktok builds the TikTok flow (JavaScript only).
const workers: Record<string, string> = { js: jsWorkerUrl, tiktok: tiktokWorkerUrl };
const workerUrl = workers[import.meta.env.VITE_WORKER ?? ""] ?? "./py_worker.js";

// VITE_DEMO_HOST=1 plays the host page itself, with a fake donation upload (see host/demo_host.ts).
if (import.meta.env.VITE_DEMO_HOST === "1") installDemoHost();

function App() {
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
    </div>
  );
}

export default App;
