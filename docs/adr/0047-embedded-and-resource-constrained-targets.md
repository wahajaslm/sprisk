# ADR-0047: Embedded and resource-constrained targets in methodology and deployment
Status: Proposed
Date: 2026-10-21
Arch doc sections: §1.2, §8, §12.2 (Edge/offline deployment mode). Builds on ADR-0040, ADR-0042, ADR-0044.

## Context
- Sprisk operates as an AI/ML and data science operating system, governing the path from raw sensor data through methodology to model deployment.
- Deployed models are increasingly targeted at embedded systems, edge hardware, and microcontrollers (MCUs like ARM Cortex-M, ESP32, and automotive ECUs) with severe hardware limits:
  - Memory: typically 32 KB – 512 KB SRAM, 128 KB – 1 MB Flash.
  - Power & Compute: battery-powered, frequent deep sleep, low clock speeds (16–160 MHz), often lacking a hardware Floating Point Unit (FPU).
  - Physical Acquisition: every feature originates from an ADC or sensor channel (I2C/SPI), consuming physical bus time and power.
- Standard ML assumptions fail on edge devices:
  - Unpruned models with multicollinear features produce wildly inflated, oscillating weights (+15,000 vs -14,980). On fixed-point INT8/INT16 arithmetic, this triggers dynamic range explosion, integer overflow, and catastrophic cancellation.
  - Retaining redundant features (e.g., via L2 Ridge shrinkage) forces the MCU to keep redundant sensors powered and sampled, wasting battery and SRAM.
  - Default tree ensembles (e.g. 200 unconstrained decision trees) exceed MCU Flash storage by orders of magnitude.
  - Microcontrollers cannot run Python runtimes or unpack pickle/joblib/skops binaries.

## Decision
- **Target runtime context as explicit facts:**
  - Methodology rules read target environment facts via `reads`:
    - `question.target_runtime`: enum `["cloud_server", "edge_gateway", "embedded_microcontroller"]` (default: `cloud_server`).
    - `question.has_hardware_fpu`: boolean.
    - `question.max_flash_kb`: optional integer resource ceiling.
- **Rules adapt recommendations for embedded targets:**
  - **Multicollinearity & Redundancy ([multicollinearity/rule.yaml](../../methodology/supervised/rules/multicollinearity/rule.yaml)):** When `question.target_runtime == "embedded_microcontroller"`, the rule strictly favors `correlation_pruning` and `vif_elimination` over `ridge_regularization`. Pruning eliminates redundant physical sensor sampling, bus traffic, and input buffer allocations.
  - **Model Selection ([ADR-0044](0044-model-shortlist-and-cross-validated-selection.md)):** Shortlist rules filter or constrain heavy tree ensembles (restricting `n_estimators` to <= 10 and `max_depth` to <= 4) and favor linear/logistic models whose inference requires only $O(1)$ memory and deterministic multiply-accumulate (MAC) loops.
- **Quantization Stability Invariant (Gate B Check):**
  - Verification check `sprisk.checks.supervised.collinearity_invariants` enforces design matrix condition number $\kappa(X) < 1000$ before model estimation.
  - Keeping condition numbers small guarantees compact weight magnitudes, enabling stable post-training quantization (PTQ) to INT8/INT16 without accuracy collapse.
- **Embedded C-Header Export Operator:**
  - Introduce an export operator (`sprisk.export.c_header`) that translates the fitted pipeline (imputer medians, `StandardScaler` $\mu$ and $\sigma$, model weights, bias, and input min/max clamping bounds) into a standalone, zero-dependency C header file (`model.h`).
  - Firmware engineers compile `model.h` directly into C/C++ firmware without external libraries or Python dependencies.

## Alternatives considered
- **Rely solely on post-training quantization tools (e.g. TFLite Micro):** Rejected: Quantization cannot fix fundamentally ill-conditioned models whose weights differ by orders of magnitude, nor can it un-sample redundant physical sensors.
- **Leave target hardware as manual user settings:** Rejected: Violates Sprisk's methodology principle. Target hardware is an explicit scientific and engineering constraint that should steer automated recommendations.
- **Target MicroPython on MCUs:** Rejected: Industrial and safety-critical edge environments (automotive ISO 26262, medical IEC 62304) run native C/C++ on RTOS, not interpreted runtimes.

## Consequences (good and bad)
- Good: Automated methodology prevents bloated, ill-conditioned models from ever being compiled for edge devices.
- Good: Eliminating redundant features directly improves device battery life and saves MCU SRAM.
- Good: Generates turnkey, zero-dependency C code ready for firmware integration.
- Bad: Adds hardware-specific fact options to the question and rule contracts.
- Bad: Embedded export is restricted to supported model families (linear, logistic, shallow trees); neural nets require separate ONNX/TFLite export pipelines.

## Validation
- When `question.target_runtime: "embedded_microcontroller"`, collinear feature sets recommend `correlation_pruning`, never `ridge_regularization`.
- A design matrix with condition number $\kappa(X) \ge 1000$ fails Gate B verification with an explicit ill-conditioning error.
- The C-header export produces valid C99 code matching scikit-learn float predictions within $10^{-5}$ relative tolerance.
