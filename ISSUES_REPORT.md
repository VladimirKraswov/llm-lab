# ISSUES REPORT

## Architectural Problems & Bugs

### 1. Dataset Preview Memory Exhaustion (High Priority)
**Problem:** `previewDataset` in `src/services/datasets.js` uses `fsp.readFile` to load the entire processed dataset into memory before slicing it.
**Consequence:** For large datasets (e.g., several GBs), the backend will crash with an Out-Of-Memory (OOM) error when a user attempts to preview the dataset.

### 2. Race Conditions in State Recovery (Medium Priority)
**Problem:** `recoverState` in `src/services/state.js` updates multiple state files (jobs, runtime, LoRAs) without using the `withLock` mechanism.
**Consequence:** If the server restarts and multiple recovery operations or new requests happen simultaneously, the state files could become corrupted or lose data due to concurrent read-modify-write cycles.

### 3. CPU-Forced LoRA Merging (Medium Priority)
**Problem:** `buildMergedLora` in `src/services/loras.js` hardcodes `device_map="cpu"` in the Python merging script.
**Consequence:** LoRA merging is extremely slow as it doesn't utilize available GPU acceleration, even if CUDA is present.

### 4. Lack of Streaming Support in Chat API (Medium Priority)
**Problem:** The `/chat` endpoint in `src/routes/runtime.js` and the frontend Playground only support blocking requests.
**Consequence:** Poor UX in the Playground; users must wait for the entire response to be generated before seeing any text, which can take a long time for LLMs.

### 5. Inconsistent Process Management (Low Priority)
**Problem:** While `killProcessGroup` is defined, its usage across `runtime.js` and `jobs.js` could be more robust, and some state updates during failure are not atomic.
**Consequence:** Potential for orphaned processes if the application crashes or fails to stop a process correctly.

## UX Improvements
- **Playground Streaming:** Implementing real-time text generation in the UI.
- **Error Visibility:** Better display of backend errors in the UI instead of silent failures or generic messages.
