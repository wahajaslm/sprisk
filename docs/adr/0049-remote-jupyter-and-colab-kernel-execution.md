# ADR-0049: Remote Jupyter and Google Colab kernel execution for deep learning
Status: Proposed
Date: 2026-10-21
Arch doc sections: §2A (Code and notebooks), §6 (execution), §11 (worker protocol), §12.2. Builds on ADR-0035, ADR-0036, ADR-0037.

## Context
- Deep learning training (e.g. PyTorch convolutional networks, recurrent models, fine-tuning transformers) requires dedicated GPU acceleration (NVIDIA CUDA or high-performance hardware).
- Data scientists and researchers frequently lack local workstation GPUs, relying instead on cloud environments like **Google Colab** (which offers free and low-cost cloud T4, V100, and A100 GPUs) or remote institutional JupyterHub instances.
- In VS Code, users can connect their notebook editor directly to Google Colab by specifying an "Existing Jupyter Server" URI and auth token.
- [ADR-0035](0035-notebook-looks-like-vs-code.md) adopted the VS Code notebook interface on Monaco, and [ADR-0036](0036-session-notebook-and-published-node.md) established the standard Jupyter kernel protocol (`jupyter_client`, `ipykernel`) for interactive exploration. However, ADR-0036 currently launches only a local subprocess.

## Decision
- **Remote Kernel Gateway support in the session host:**
  - Extend the Python session host (`sprisk_code.session`) and Rust API kernel relay to support **Remote Jupyter Server / Gateway endpoints** via standard Jupyter WebSocket protocol.
- **Kernel Selector in the Notebook View ([NotebooksPage.tsx](../../apps/web/src/views/notebook/NotebooksPage.tsx)):**
  - In the notebook top toolbar, next to the kernel status indicator, provide a **Kernel Connection Dialog**:
    - **Local Python Environment:** (default) launches local `ipykernel`.
    - **Remote Jupyter / Google Colab:** accepts a Jupyter Server Base URL (e.g. `https://localhost:8080/` forwarded from Colab or a cloud VM) and an authorization token.
- **Remote Execution & Streaming:**
  - Cells executed in Sprisk stream execution requests over WebSockets to the remote Colab/Jupyter kernel.
  - Real-time text outputs, stdout/stderr, progress bars, and matplotlib/PyTorch figures stream directly back into the Monaco notebook cell outputs via the existing streaming protocol ([ADR-0041](0041-notebook-delete-rename-and-streaming.md)).
- **Preserve Flow Boundary Creation:**
  - The "Create node from cells" workflow ([ADR-0036](0036-session-notebook-and-published-node.md#L22)) remains fully functional: a user can prototype and train models on remote Colab GPUs, select the cells, and publish them into the flow as a versioned, typed node.

## Alternatives considered
- **Require users to run Sprisk entirely inside Google Colab:** Rejected: Sprisk is an open-source, local-first platform designed to run natively on the developer's machine with local persistence and offline access.
- **Support custom remote SSH worker daemons first:** Rejected: Connecting via the standard Jupyter Kernel Protocol requires zero extra software installed on Colab besides standard Jupyter, matching existing VS Code workflows.

## Consequences (good and bad)
- Good: Enables deep learning and GPU-heavy training for users without local GPU hardware.
- Good: Users retain the local-first Sprisk workbench while leveraging free/inexpensive cloud GPUs on Google Colab.
- Good: Reuses the existing `jupyter_client` protocol rather than inventing a custom remote execution wire format.
- Bad: Remote kernel latency is subject to network stability.
- Bad: Local filesystem paths referenced in notebook cells will not resolve if data resides only on the local machine; users must mount Google Drive or stream data tables.

## Validation
- Pointing Sprisk's remote kernel connection to a running Jupyter server / Colab local-runtime bridge successfully connects and displays the remote Python version and GPU device name (`torch.cuda.get_device_name(0)`).
- Cell execution streams stdout and rich figures back to the Sprisk UI without blocking the local Rust control plane.
