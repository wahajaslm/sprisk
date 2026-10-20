import type { PipelineVersion } from "@sprisk/contracts";
import { useMemo, useState } from "react";

import { usePipelineVersions, useRuns } from "../../api/hooks.ts";
import { useApplyMethodology, useResolveMethodology, useResolveSplit } from "../../api/methodology.ts";
import { useQuestionVersions } from "../../api/questions.ts";
import { flowName } from "../../flow/labels.ts";
import { useSelection } from "../../workbench/selection.ts";
import { METHODOLOGY_RULES, METHODOLOGY_STAGES, POLICY_PRESETS } from "./methodologyData.ts";
import { MethodologyDendrogram } from "./MethodologyDendrogram.tsx";
import type { MethodologyPack, MethodologyRule, MethodologyStageId, PolicyPreset } from "./types.ts";

export function MethodologyPage() {
  const { pipelineVersionId, selectNode, setNav, selectPipelineVersion } = useSelection();
  const versions = usePipelineVersions();
  const questions = useQuestionVersions();
  const runs = useRuns(pipelineVersionId);

  const currentPipeline = versions.data?.find((v) => v.id === pipelineVersionId);
  const currentQuestion = questions.data?.find((q) => q.id === currentPipeline?.question_version_id);
  const latestRun = runs.data?.[0];

  // Config adaptability state
  const [activePreset, setActivePreset] = useState<string>("standard_production");
  const [thresholds, setThresholds] = useState<Record<string, number | boolean | string>>(() => {
    const defaultPreset = POLICY_PRESETS.find((p) => p.id === "standard_production") ?? POLICY_PRESETS[0];
    return defaultPreset ? { ...defaultPreset.thresholdOverrides } : {};
  });

  const [ruleToggles, setRuleToggles] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const r of METHODOLOGY_RULES) initial[r.id] = true;
    return initial;
  });

  // Filtering state
  const [selectedStage, setSelectedStage] = useState<MethodologyStageId | "all">("all");
  const [selectedPack, setSelectedPack] = useState<MethodologyPack | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeViewMode, setActiveViewMode] = useState<"dendrogram" | "config" | "bindings">("dendrogram");

  const activePresetObj = POLICY_PRESETS.find((p) => p.id === activePreset);
  const activePresetName = activePresetObj?.name ?? "Custom Adaptive";

  // Handle Preset Switching
  const handleSelectPreset = (preset: PolicyPreset) => {
    setActivePreset(preset.id);
    setThresholds({ ...preset.thresholdOverrides });
  };

  const handleUpdateThreshold = (key: string, value: number | boolean | string) => {
    setThresholds((prev) => ({ ...prev, [key]: value }));
    setActivePreset("custom");
  };

  const handleToggleRule = (ruleId: string) => {
    setRuleToggles((prev) => ({ ...prev, [ruleId]: !prev[ruleId] }));
  };

  // Filtered Rules
  const filteredRules = useMemo(() => {
    return METHODOLOGY_RULES.filter((rule) => {
      if (selectedStage !== "all" && rule.stage !== selectedStage) return false;
      if (selectedPack !== "all" && rule.pack !== selectedPack) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesName = rule.name.toLowerCase().includes(query);
        const matchesId = rule.id.toLowerCase().includes(query);
        const matchesDecides = rule.decides.toLowerCase().includes(query);
        const matchesCitation = rule.provenance.citation.toLowerCase().includes(query);
        const matchesPitfall = rule.provenance.pitfall.toLowerCase().includes(query);
        if (!matchesName && !matchesId && !matchesDecides && !matchesCitation && !matchesPitfall) {
          return false;
        }
      }
      return true;
    });
  }, [selectedStage, selectedPack, searchQuery]);

  // Map nodes of active pipeline to methodology stages
  const stageNodeMap = useMemo(() => {
    const map: Record<MethodologyStageId, { nodeId: string; operator: string; ruleId?: string }[]> = {
      question: [],
      ingestion: [],
      cleaning: [],
      split: [],
      features: [],
      modeling: [],
      eval: [],
      governance: [],
    };

    if (!currentPipeline) return map;

    for (const node of currentPipeline.nodes) {
      const op = node.operator;
      if (op.includes("split@")) {
        map.split.push({ nodeId: node.id, operator: op, ruleId: "methodology.supervised.data_split@1.0.0" });
      } else if (op.includes("impute@") || op.includes("drop_missing@") || op.includes("clip_outliers@")) {
        map.cleaning.push({ nodeId: node.id, operator: op, ruleId: "methodology.supervised.missingness@1.0.0" });
      } else if (op.includes("scale@") || op.includes("one_hot@") || op.includes("target_encode@") || op.includes("pca@") || op.includes("umap@")) {
        map.features.push({ nodeId: node.id, operator: op, ruleId: "methodology.supervised.feature_scaling@1.0.0" });
      } else if (op.includes("kmeans") || op.includes("dbscan") || op.includes("gmm") || op.includes("anomaly") || op.includes("linear@") || op.includes("lgbm@")) {
        map.modeling.push({ nodeId: node.id, operator: op, ruleId: "methodology.supervised.model_baseline_selection@1.0.0" });
      } else if (op.includes("eval") || op.includes("metric") || op.includes("auc")) {
        map.eval.push({ nodeId: node.id, operator: op, ruleId: "methodology.supervised.evaluation_metric@1.0.0" });
      } else if (op.includes("source.") || op.includes("read_")) {
        map.ingestion.push({ nodeId: node.id, operator: op });
      } else {
        map.governance.push({ nodeId: node.id, operator: op });
      }
    }

    return map;
  }, [currentPipeline]);

  const activeRulesCount = useMemo(() => {
    return Object.values(ruleToggles).filter(Boolean).length;
  }, [ruleToggles]);

  return (
    <main className="methodology-page" role="main" aria-label="Methodology Map">
      <MethodologyDendrogram
        stages={METHODOLOGY_STAGES}
        rules={METHODOLOGY_RULES}
        ruleToggles={ruleToggles}
        onToggleRule={handleToggleRule}
        selectedStage={selectedStage}
        onSelectStage={setSelectedStage}
        selectedPack={selectedPack}
        onSelectPack={setSelectedPack}
        thresholds={thresholds}
        onUpdateThreshold={handleUpdateThreshold}
        currentPipeline={currentPipeline}
        stageNodeMap={stageNodeMap}
        onInspectNode={(nodeId) => {
          selectNode(nodeId);
          setNav("Flow");
        }}
        activePreset={activePreset}
        onSelectPreset={handleSelectPreset}
        activePresetName={activePresetName}
        activeTab={activeViewMode}
        onSelectTab={(tab) => setActiveViewMode(tab as any)}
      />
    </main>
  );
}
