import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { PARQUET } from "../src/api/media.ts";
import { NodeVisual } from "../src/views/NodeVisual.tsx";
import { scoreOutputs } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

const ATT1 = "att_01JABCDEFGHJKMNPQRSTVWXY11";
const ART1 = "art_01JABCDEFGHJKMNPQRSTVWXY11";
const ATT2 = "att_01JABCDEFGHJKMNPQRSTVWXY12";
const ART2 = "art_01JABCDEFGHJKMNPQRSTVWXY12";
const ATT3 = "att_01JABCDEFGHJKMNPQRSTVWXY13";
const ART3 = "art_01JABCDEFGHJKMNPQRSTVWXY13";
const ATT4 = "att_01JABCDEFGHJKMNPQRSTVWXY14";
const ART4A = "art_01JABCDEFGHJKMNPQRSTVWXY14";
const ART4B = "art_01JABCDEFGHJKMNPQRSTVWXY15";
const ATT5 = "att_01JABCDEFGHJKMNPQRSTVWXY15";
const ATT6 = "att_01JABCDEFGHJKMNPQRSTVWXY16";
const ART6A = "art_01JABCDEFGHJKMNPQRSTVWXY16";
const ART6B = "art_01JABCDEFGHJKMNPQRSTVWXY17";

const mockArtifact = (id: string, producer_attempt_id: string, media_type = PARQUET) => ({
  ...scoreOutputs[0]!.artifact,
  id,
  producer_attempt_id,
  media_type,
});

describe("in-node analysis visualizations", () => {
  it("renders cluster distribution with cluster pills and noise for clustering operators", async () => {
    server.use(
      http.get(`/api/attempts/${ATT1}/outputs`, () =>
        HttpResponse.json([
          {
            port: "clusters",
            artifact: mockArtifact(ART1, ATT1),
          },
        ]),
      ),
      http.get(`/api/artifacts/${ART1}/rows`, () =>
        HttpResponse.json({
          offset: 0,
          total_rows: 5,
          total_columns: 2,
          columns: [
            { name: "f1", data_type: "Float64" },
            { name: "cluster", data_type: "Int32" },
          ],
          rows: [
            { values: ["1.2", "0"], missing: [] },
            { values: ["1.4", "0"], missing: [] },
            { values: ["2.1", "1"], missing: [] },
            { values: ["2.3", "1"], missing: [] },
            { values: ["9.9", "-1"], missing: [] },
          ],
        }),
      ),
    );

    renderWithApi(
      <NodeVisual
        attemptId={ATT1}
        operator="sprisk.clustering.dbscan@1.0.0"
        capability="transform"
        params={{ eps: 0.5, min_samples: 2 }}
        pipelineVersionId="pv_1"
        nodeId="dbscan_node"
        metricsPort={undefined}
      />,
    );

    expect(await screen.findByText("K=2 clusters")).toBeInTheDocument();
    expect(await screen.findByText("C0: 40%")).toBeInTheDocument();
    expect(await screen.findByText("C1: 40%")).toBeInTheDocument();
    expect(await screen.findByText("Noise 20%")).toBeInTheDocument();
  });

  it("renders acoustic spectral gating attenuation curve and noise threshold stats", async () => {
    server.use(
      http.get(`/api/attempts/${ATT2}/outputs`, () =>
        HttpResponse.json([
          {
            port: "train",
            artifact: mockArtifact(ART2, ATT2),
          },
        ]),
      ),
      http.get(`/api/artifacts/${ART2}/rows`, () =>
        HttpResponse.json({
          offset: 0,
          total_rows: 4,
          total_columns: 2,
          columns: [
            { name: "signal", data_type: "Float64" },
            { name: "spectral_gate_gain", data_type: "Float64" },
          ],
          rows: [
            { values: ["0.02", "0.15"], missing: [] },
            { values: ["0.05", "0.40"], missing: [] },
            { values: ["0.80", "1.00"], missing: [] },
            { values: ["0.90", "1.00"], missing: [] },
          ],
        }),
      ),
    );

    renderWithApi(
      <NodeVisual
        attemptId={ATT2}
        operator="sprisk.clean.spectral_gating@1.0.0"
        capability="transform"
        params={{ threshold_db: -6.0, attenuation_factor: 0.15, signal_column: "signal", snr_column: "snr" }}
        pipelineVersionId="pv_1"
        nodeId="spectral_gate"
        metricsPort={undefined}
      />,
    );

    expect(await screen.findByText("-6 dB")).toBeInTheDocument();
    expect(await screen.findByText("50%")).toBeInTheDocument();
    expect(await screen.findByText("0.15×")).toBeInTheDocument();
  });

  it("renders ranked permutation feature importance impact bars", async () => {
    server.use(
      http.get(`/api/attempts/${ATT3}/outputs`, () =>
        HttpResponse.json([
          {
            port: "importance",
            artifact: mockArtifact(ART3, ATT3),
          },
        ]),
      ),
      http.get(`/api/artifacts/${ART3}/rows`, () =>
        HttpResponse.json({
          offset: 0,
          total_rows: 3,
          total_columns: 3,
          columns: [
            { name: "feature", data_type: "Utf8" },
            { name: "importance", data_type: "Float64" },
            { name: "std", data_type: "Float64" },
          ],
          rows: [
            { values: ["acoustic_snr", "0.421", "0.03"], missing: [] },
            { values: ["rms_energy", "0.284", "0.02"], missing: [] },
            { values: ["spectral_flux", "0.092", "0.01"], missing: [] },
          ],
        }),
      ),
    );

    renderWithApi(
      <NodeVisual
        attemptId={ATT3}
        operator="sprisk.ml.feature_importance@1.0.0"
        capability="evaluator"
        params={{ target: "label" }}
        pipelineVersionId="pv_1"
        nodeId="feat_imp"
        metricsPort={undefined}
      />,
    );

    expect(await screen.findByText("acoustic_snr")).toBeInTheDocument();
    expect(await screen.findByText("0.421")).toBeInTheDocument();
    expect(await screen.findByText("rms_energy")).toBeInTheDocument();
    expect(await screen.findByText("0.284")).toBeInTheDocument();
    expect(await screen.findByText("feature impact")).toBeInTheDocument();
  });

  it("renders profile distribution frequency shapes and correlation", async () => {
    server.use(
      http.get(`/api/attempts/${ATT4}/outputs`, () =>
        HttpResponse.json([
          {
            port: "histograms",
            artifact: mockArtifact(ART4A, ATT4),
          },
          {
            port: "correlation",
            artifact: mockArtifact(ART4B, ATT4),
          },
        ]),
      ),
      http.get(`/api/artifacts/${ART4A}/rows`, () =>
        HttpResponse.json({
          offset: 0,
          total_rows: 4,
          total_columns: 4,
          columns: [
            { name: "column_name", data_type: "Utf8" },
            { name: "bin_lower", data_type: "Float64" },
            { name: "bin_upper", data_type: "Float64" },
            { name: "count", data_type: "Int64" },
          ],
          rows: [
            { values: ["signal_amp", "0.0", "0.5", "42"], missing: [] },
            { values: ["signal_amp", "0.5", "1.0", "18"], missing: [] },
            { values: ["noise_db", "-30.0", "-15.0", "10"], missing: [] },
            { values: ["noise_db", "-15.0", "0.0", "50"], missing: [] },
          ],
        }),
      ),
      http.get(`/api/artifacts/${ART4B}/rows`, () =>
        HttpResponse.json({
          offset: 0,
          total_rows: 1,
          total_columns: 3,
          columns: [
            { name: "column_a", data_type: "Utf8" },
            { name: "column_b", data_type: "Utf8" },
            { name: "pearson", data_type: "Float64" },
          ],
          rows: [{ values: ["signal_amp", "noise_db", "0.78"], missing: [] }],
        }),
      ),
    );

    renderWithApi(
      <NodeVisual
        attemptId={ATT4}
        operator="sprisk.profile.distributions@1.0.0"
        capability="analyzer"
        params={{}}
        pipelineVersionId="pv_1"
        nodeId="dist_node"
        metricsPort={undefined}
      />,
    );

    expect(await screen.findByText("signal_amp")).toBeInTheDocument();
    expect(await screen.findByText("noise_db")).toBeInTheDocument();
    expect(await screen.findByText("2 numeric dists")).toBeInTheDocument();
    expect(await screen.findByText("0.78")).toBeInTheDocument();
  });

  it("renders outlier clipping quantile thresholds", async () => {
    server.use(
      http.get(`/api/attempts/${ATT5}/outputs`, () => HttpResponse.json([])),
    );

    renderWithApi(
      <NodeVisual
        attemptId={ATT5}
        operator="sprisk.clean.clip_outliers@1.0.0"
        capability="transform"
        params={{ lower_quantile: 0.02, upper_quantile: 0.98, columns: ["audio_amp", "snr"] }}
        pipelineVersionId="pv_1"
        nodeId="clip_node"
        metricsPort={undefined}
      />,
    );

    expect(await screen.findByText("P2–P98")).toBeInTheDocument();
    expect(await screen.findByText("2 cols clipped")).toBeInTheDocument();
  });

  it("renders group split grouping column subnote", async () => {
    server.use(
      http.get(`/api/attempts/${ATT6}/outputs`, () =>
        HttpResponse.json([
          {
            port: "train",
            artifact: mockArtifact(ART6A, ATT6),
          },
          {
            port: "test",
            artifact: mockArtifact(ART6B, ATT6),
          },
        ]),
      ),
      http.get(`/api/artifacts/${ART6A}/rows`, () =>
        HttpResponse.json({ offset: 0, columns: [], rows: [], total_rows: 160, total_columns: 4 }),
      ),
      http.get(`/api/artifacts/${ART6B}/rows`, () =>
        HttpResponse.json({ offset: 0, columns: [], rows: [], total_rows: 40, total_columns: 4 }),
      ),
    );

    renderWithApi(
      <NodeVisual
        attemptId={ATT6}
        operator="sprisk.validation.group_split@1.0.0"
        capability="transform"
        params={{ group_column: "speaker_id", train_fraction: 0.8 }}
        pipelineVersionId="pv_1"
        nodeId="split_node"
        metricsPort={undefined}
      />,
    );

    expect(await screen.findByText("160")).toBeInTheDocument();
    expect(await screen.findByText("40")).toBeInTheDocument();
    expect(await screen.findByText(/Grouped by/)).toBeInTheDocument();
    expect(await screen.findByText("speaker_id")).toBeInTheDocument();
  });
});
