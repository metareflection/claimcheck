include "../../../../dafny-replay/colorwheel/ColorWheelDomain.dfy"
include "../../../../dafny-replay/colorwheel/ColorWheelSpec.dfy"

module ColorWheelClaims {
  import opened ColorWheelDomain
  import CWSpec = ColorWheelSpec

  lemma BaseHueInRange(m: Model)
    requires Inv(m)
    ensures CWSpec.ValidBaseHue(m.baseHue)
  { }

  lemma AlwaysFiveColors(m: Model)
    requires Inv(m)
    ensures |m.colors| == 5
  { }

  lemma AllColorsValid(m: Model)
    requires Inv(m)
    ensures forall i | 0 <= i < 5 :: CWSpec.ValidColor(m.colors[i])
  { }

  lemma ContrastPairIndicesValid(m: Model)
    requires Inv(m)
    ensures 0 <= m.contrastPair.0 < 5
    ensures 0 <= m.contrastPair.1 < 5
  { }

  lemma MoodConstraintsSatisfied(m: Model)
    requires Inv(m)
    requires m.mood != CWSpec.Mood.Custom
    ensures forall i | 0 <= i < 5 :: CWSpec.ColorSatisfiesMood(m.colors[i], m.mood)
  { }

  lemma HuesFollowHarmony(m: Model)
    requires Inv(m)
    ensures CWSpec.HuesMatchHarmony(m.colors, m.baseHue, m.harmony)
  { }

  lemma PaletteNonEmpty(m: Model)
    requires Inv(m)
    ensures |m.colors| >= 1
  { }
}
