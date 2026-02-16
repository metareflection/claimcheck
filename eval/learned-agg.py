#!/usr/bin/env python3
"""
Learned aggregation over grounded decomposition features.

Takes a results JSON file from bench-healthver.js (or any bench that saves
grounded output) and evaluates whether a simple classifier over per-assertion
features beats the model's own verdict.

Usage:
  python3 eval/learned-agg.py eval/results/healthver-grounded-features-full.json
  python3 eval/learned-agg.py eval/results/healthver-grounded-features-full.json --train-split 0.5
  python3 eval/learned-agg.py --train eval/results/train.json --test eval/results/test.json
"""

import argparse
import json
import sys
from collections import Counter

try:
    import numpy as np
    from sklearn.linear_model import LogisticRegression
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False

LABEL_MAP = {'SUPPORTS': 0, 'REFUTES': 1, 'NOT_ENOUGH_INFO': 2}
LABELS = ['SUPPORTS', 'REFUTES', 'NOT_ENOUGH_INFO']
VERDICT_NORM = {
    'SUPPORTS': 'SUPPORTS', 'REFUTES': 'REFUTES',
    'NOT_ENOUGH_INFO': 'NOT_ENOUGH_INFO', 'CONTRADICTS': 'REFUTES',
}
NO_EVIDENCE_PHRASES = frozenset([
    'no relevant evidence', 'no relevant evidence.', '',
])


def extract_features(result):
    """Extract assertion-level features from a grounded result entry."""
    g = result.get('grounded')
    if not g or not isinstance(g, dict) or not g.get('assertions'):
        return None

    assertions = [a for a in g['assertions'] if isinstance(a, dict)]
    if not assertions:
        return None

    n = len(assertions)
    n_sup = sum(1 for a in assertions if a.get('relationship') == 'SUPPORTS')
    n_contra = sum(1 for a in assertions if a.get('relationship') == 'CONTRADICTS')
    n_noev = sum(1 for a in assertions if a.get('relationship') == 'NO_EVIDENCE')
    n_cited = sum(
        1 for a in assertions
        if a.get('evidence_span', '').lower().strip() not in NO_EVIDENCE_PHRASES
    )

    return {
        'frac_sup': n_sup / n,
        'frac_contra': n_contra / n,
        'frac_noev': n_noev / n,
        'frac_cited': n_cited / n,
        'n_assertions': n,
        'has_sup': 1 if n_sup > 0 else 0,
        'has_contra': 1 if n_contra > 0 else 0,
    }


FEATURE_NAMES = [
    'frac_sup', 'frac_contra', 'frac_noev', 'frac_cited',
    'n_assertions', 'has_sup', 'has_contra',
]


def features_to_vec(feat):
    return [feat[k] for k in FEATURE_NAMES]


def load_rows(path):
    """Load results file and extract feature rows."""
    with open(path) as f:
        data = json.load(f)

    rows = []
    skipped = 0
    for r in data['results']:
        feat = extract_features(r)
        v = VERDICT_NORM.get(r.get('verdict'))
        if not feat or not v or r['expected'] not in LABEL_MAP:
            skipped += 1
            continue
        rows.append({
            'expected': r['expected'],
            'model_verdict': v,
            'features': feat,
        })

    if skipped:
        print(f"  (skipped {skipped} entries without grounded output)", file=sys.stderr)
    return rows


def threshold_predict(rows, sup_t, contra_t):
    """Apply threshold rule to rows."""
    preds = []
    for r in rows:
        f = r['features']
        if f['frac_contra'] >= contra_t and contra_t > 0:
            preds.append('REFUTES')
        elif f['frac_sup'] >= sup_t:
            preds.append('SUPPORTS')
        else:
            preds.append('NOT_ENOUGH_INFO')
    return preds


def grid_search_threshold(rows):
    """Find best (sup_t, contra_t) thresholds on given rows."""
    best_acc = 0
    best_rule = (0.5, 0.5)
    for sup_t in [x / 20 for x in range(0, 21)]:
        for contra_t in [x / 20 for x in range(0, 21)]:
            preds = threshold_predict(rows, sup_t, contra_t)
            correct = sum(1 for p, r in zip(preds, rows) if p == r['expected'])
            acc = correct / len(rows)
            if acc > best_acc:
                best_acc = acc
                best_rule = (sup_t, contra_t)
    return best_rule, best_acc


def evaluate(rows, preds, label=''):
    """Print accuracy summary."""
    correct = sum(1 for p, r in zip(preds, rows) if p == r['expected'])
    total = len(rows)
    print(f"  {label}: {correct}/{total} ({correct/total:.1%})")

    for lbl in LABELS:
        subset = [(p, r) for p, r in zip(preds, rows) if r['expected'] == lbl]
        if not subset:
            continue
        n_correct = sum(1 for p, r in subset if p == lbl)
        print(f"    {lbl}: {n_correct}/{len(subset)} ({n_correct/len(subset):.0%})")

    return correct / total


def run_split(train_rows, test_rows):
    """Train on train_rows, evaluate on test_rows."""
    print(f"\nTrain: {len(train_rows)}, Test: {len(test_rows)}")

    # Model's own verdict
    model_preds = [r['model_verdict'] for r in test_rows]
    print()
    evaluate(test_rows, model_preds, label='Model verdict')

    # Threshold rule
    (sup_t, contra_t), train_acc = grid_search_threshold(train_rows)
    print(f"\n  Threshold (train): sup>={sup_t:.2f}, contra>={contra_t:.2f} ({train_acc:.1%})")
    thresh_preds = threshold_predict(test_rows, sup_t, contra_t)
    evaluate(test_rows, thresh_preds, label='Threshold (test)')

    # Logistic regression
    if HAS_SKLEARN:
        X_train = np.array([features_to_vec(r['features']) for r in train_rows])
        y_train = np.array([LABEL_MAP[r['expected']] for r in train_rows])
        X_test = np.array([features_to_vec(r['features']) for r in test_rows])

        clf = LogisticRegression(max_iter=1000, C=1.0)
        clf.fit(X_train, y_train)
        lr_preds_idx = clf.predict(X_test)
        lr_preds = [LABELS[i] for i in lr_preds_idx]
        print()
        evaluate(test_rows, lr_preds, label='Logistic regression (test)')

        print(f"\n  Coefficients:")
        for i, cls in enumerate(LABELS):
            top = sorted(zip(FEATURE_NAMES, clf.coef_[i]), key=lambda x: -abs(x[1]))
            print(f"    {cls}: " + ", ".join(f"{n}={c:+.2f}" for n, c in top[:4]))
    else:
        print("\n  (sklearn not installed, skipping logistic regression)")


def main():
    parser = argparse.ArgumentParser(description='Learned aggregation over grounded features')
    parser.add_argument('input', nargs='?', help='Results JSON with grounded output')
    parser.add_argument('--train', help='Separate training results file')
    parser.add_argument('--test', help='Separate test results file')
    parser.add_argument('--train-split', type=float, default=0.5,
                        help='Fraction for training when using single file (default: 0.5)')
    parser.add_argument('--seed', type=int, default=42, help='Random seed for split')
    args = parser.parse_args()

    if args.train and args.test:
        train_rows = load_rows(args.train)
        test_rows = load_rows(args.test)
        print(f"Train file: {args.train} ({len(train_rows)} rows)")
        print(f"Test file: {args.test} ({len(test_rows)} rows)")
        run_split(train_rows, test_rows)
    elif args.input:
        rows = load_rows(args.input)
        print(f"Input: {args.input} ({len(rows)} rows)")

        # Random split
        import random
        random.seed(args.seed)
        indices = list(range(len(rows)))
        random.shuffle(indices)
        split = int(len(rows) * args.train_split)
        train_rows = [rows[i] for i in indices[:split]]
        test_rows = [rows[i] for i in indices[split:]]
        run_split(train_rows, test_rows)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == '__main__':
    main()
