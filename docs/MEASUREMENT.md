# Measurement and sampling

For context `c` and X condition `x`, let `N(c,x)` be the number of accepted decisions and `A(c,x)` the number choosing the designated action. The program computes:

```text
p(c,x) = A(c,x) / N(c,x)
theta(c) = p(c,1) - p(c,0)
change_from_reference(c) = theta(c) - theta(reference)
```

Reports display rates as percentages and contrasts as percentage points. The designated action is the study's decision proxy for Y. The labels `positive` and `negative` in the data refer to designated and alternative actions; they do not imply that either action is desirable.

## Keep the full response distribution

The denominator includes all four accepted outcomes: designated action, alternative action, equivalence, and insufficient information. A neutral answer is not recoded as the alternative action. Counts for all four outcomes are saved separately.

For example, a shift from the alternative to equivalence can reveal a meaningful change in the choice distribution while leaving designated-action selection at zero. The collaboration-history website example illustrates why the summary contrast should be read alongside these counts.

## Presentation pairs

With `perCondition = 12`, each X condition contains six blocks, each with two independently requested decisions in reversed presentation order. A block shares its A/B mapping across X0 and X1. The coordinator uses the hidden semantic mapping to compare outcomes after presentation changes.

Mirror agreement is the proportion of complete pairs returning the same semantic outcome. All four categories enter this comparison. An agreement diagnostic can reveal presentation sensitivity, but agreement alone does not establish model validity.

The program flags designated-action rates at or below 5% or at or above 95%. These floor and ceiling flags help the planner notice limited room for further decreases or increases.

## Interpreting contextual differences

`theta(c)` is a descriptive contrast in generated decisions. Comparing it with the reference contrast asks whether the same X manipulation accompanies a different response pattern under the new facts. The system does not automatically label these differences statistically significant or estimate a population causal interaction.

The search is adaptive: later contexts depend on earlier results. It is designed to produce candidate studies, not a representative sample of all possible settings. Repeated API calls measure the behavior of the configured model and prompt. Testing a proposed contextual boundary with people, field data, or another independent source is a separate research design.

## Call budget

For `R` rounds, `K` selected contexts per round, and `n` decisions per X condition:

```text
contexts_evaluated = 1 + R * K
actor_calls = 2 * n * (1 + R * K)
other_calls = 1 design + R plan + R review + R reflect + 1 report
normal_total = 2 * n * (1 + R * K) + 3 * R + 2
```

The default `R=5`, `K=2`, `n=12` requires 264 actor calls and 17 other calls, for 281 API calls. Optional extraction, proposal revisions, and provider retries add to this total. Returned usage is saved so actual consumption can be inspected.
