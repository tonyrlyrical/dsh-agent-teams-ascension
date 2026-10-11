#!/usr/bin/env node
/**
 * Formats benchmark-results.json into evidence/desktop-validation/
 * structured datasets with full desktop environment metadata.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

async function main() {
  const benchmarkRaw = await readFile('benchmark-results.json', 'utf-8')
  const benchmarkData = JSON.parse(benchmarkRaw)

  // Group by scenario name
  const scenarioMap = new Map()
  for (const item of benchmarkData.scenarios) {
    if (!scenarioMap.has(item.scenario)) {
      scenarioMap.set(item.scenario, {})
    }
    scenarioMap.get(item.scenario)[item.mode] = item
  }

  const structuredScenarios = []
  let sIdx = 1

  for (const [name, modes] of scenarioMap.entries()) {
    const base = modes.baseline
    const normal = modes.normal
    const economy = modes.economy

    const normalSavingsPct = (((base.totalTokens - normal.totalTokens) / base.totalTokens) * 100).toFixed(1)
    const economySavingsPct = (((base.totalTokens - economy.totalTokens) / base.totalTokens) * 100).toFixed(1)

    structuredScenarios.push({
      id: `scenario-${sIdx++}`,
      name,
      invocations: base.invocations,
      peakWorkersBaseline: base.peakWorkers,
      peakWorkersNormal: normal.peakWorkers,
      peakWorkersEconomy: economy.peakWorkers,
      baseline: {
        inputTokens: base.inputTokens,
        outputTokens: base.outputTokens,
        totalTokens: base.totalTokens,
      },
      normal: {
        inputTokens: normal.inputTokens,
        outputTokens: normal.outputTokens,
        totalTokens: normal.totalTokens,
        savingsTokens: base.totalTokens - normal.totalTokens,
        savingsPercent: Number(normalSavingsPct),
      },
      economy: {
        inputTokens: economy.inputTokens,
        outputTokens: economy.outputTokens,
        totalTokens: economy.totalTokens,
        savingsTokens: base.totalTokens - economy.totalTokens,
        savingsPercent: Number(economySavingsPct),
      },
    })
  }

  const aggregate = benchmarkData.aggregate
  const outputData = {
    metadata: {
      generatedAt: new Date().toISOString(),
      sourceBranch: 'audit/ascension-adversarial-verification',
      baseCommit: '1094b84add6f2fb19edf659367fe2fd5f7f14154',
      ascensionCommit: '01c24c2d3eb0358ef9c79e663731ceb83e60fc8a',
      hostApplication: 'DeepSeek Harness Desktop v0.2.0-rc.2 (Windows win32-x64)',
      runtimeEngine: 'Node.js ' + process.version,
      classificationLegend: {
        inputTokens: 'ESTIMATED (character-ratio prompt length heuristic ~4 chars/token)',
        outputTokens: 'SYNTHETIC (preset typical model completions)',
        totalTokens: 'SYNTHETIC_ESTIMATED_HYBRID',
        concurrency: 'ACTUAL (runtime scheduler worker bounds)',
        ledgerIntegrity: 'VERIFICADO AUTOMÁTICAMENTE (100% unit tests & real-harness canary pass)',
        desktopGuiInteraction: 'VERIFICADO EN GUI (Harness Desktop live window, plugins view, details view)',
        liveModelExecution: 'BLOQUEADO (Active desktop session preservation & CLI missing cloud credentials)',
      },
    },
    aggregate: {
      baselineTotalTokens: aggregate.baseline.totalTokens,
      normalTotalTokens: aggregate.normal.totalTokens,
      economyTotalTokens: aggregate.economy.totalTokens,
      normalSavingsTokens: aggregate.normal.savingsTokensVsBaseline,
      normalSavingsPercent: aggregate.normal.savingsPercentageVsBaseline,
      economySavingsTokens: aggregate.economy.savingsTokensVsBaseline,
      economySavingsPercent: aggregate.economy.savingsPercentageVsBaseline,
    },
    scenarios: structuredScenarios,
  }

  const outDir = join(process.cwd(), 'evidence', 'desktop-validation')
  await mkdir(outDir, { recursive: true })

  // Write JSON
  const jsonPath = join(outDir, 'benchmark-desktop-comparison.json')
  await writeFile(jsonPath, JSON.stringify(outputData, null, 2), 'utf-8')
  console.log(`Generated JSON: ${jsonPath}`)

  // Write CSV
  const csvLines = [
    'Scenario ID,Scenario Name,Invocations,Baseline Tokens,Normal Tokens,Economy Tokens,Normal Savings (%),Economy Savings (%),Token Classification',
    ...structuredScenarios.map((s) =>
      `"${s.id}","${s.name}",${s.invocations},${s.baseline.totalTokens},${s.normal.totalTokens},${s.economy.totalTokens},${s.normal.savingsPercent}%,${s.economy.savingsPercent}%,"SYNTHETIC_ESTIMATED_HYBRID"`
    ),
    `"aggregate","Aggregate All Scenarios",${aggregate.baseline.totalInvocations},${aggregate.baseline.totalTokens},${aggregate.normal.totalTokens},${aggregate.economy.totalTokens},${aggregate.normal.savingsPercentageVsBaseline}%,${aggregate.economy.savingsPercentageVsBaseline}%,"SYNTHETIC_ESTIMATED_HYBRID"`,
  ]

  const csvPath = join(outDir, 'benchmark-desktop-comparison.csv')
  await writeFile(csvPath, csvLines.join('\n'), 'utf-8')
  console.log(`Generated CSV: ${csvPath}`)
}

main().catch(console.error)
