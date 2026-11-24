package main

import (
	"regexp"
	"strings"
)

// Dice rolls (bible 11): a number or calculated field can have a dice rule, e.g. [roll:2d20<VALUE|VALUE].
// WA turns [roll:…] in the sheet into a roll (not in the form). VALUE becomes the field's value.
// The value is put into a {% set %} line first, so the roll line stays short (the WA filter can
// remove long expressions with many brackets).

// diceRuleRe: the whole [roll:…] code. No braces, quotes or % (Twig and WA filter), so groups like
// {4d6+2d8} cannot be written.
var diceRuleRe = regexp.MustCompile(`^\[roll:[A-Za-z0-9 +\-*/<>=!.,:|^()]*\]$`)

func diceRuleOf(n *Node) string { return strings.TrimSpace(propString(n, "dice")) }

// diceRule is the rule of a field that can roll; "" when there is none or it does not fit the field.
func diceRule(n *Node) string {
	if ft := propString(n, "fieldType"); ft != "number" && ft != "calc" {
		return ""
	}
	return diceRuleOf(n)
}

// diceValueVar is the Twig variable that holds the value of the field in the sheet.
func diceValueVar(n *Node) string { return "dice_" + propString(n, "name") }

// diceText is the text shown in the sheet: the rule with VALUE replaced by the value variable.
// {# dice name #} lets the preview find it.
func diceText(n *Node) string {
	v := diceValueVar(n)
	return "{# dice " + propString(n, "name") + " #}" + strings.ReplaceAll(diceRule(n), "VALUE", "{{"+v+"}}")
}

// validateDice checks the dice rule of a field.
func validateDice(n *Node) []Problem {
	rule := diceRuleOf(n)
	if rule == "" {
		return nil
	}
	name := propString(n, "name")
	if ft := propString(n, "fieldType"); ft != "number" && ft != "calc" {
		return []Problem{errorf(n.ID, "field %q: only number and calculated fields can have a dice roll", name)}
	}
	if !diceRuleRe.MatchString(rule) {
		return []Problem{errorf(n.ID, "field %q: the dice roll must look like [roll:1d20+VALUE] and use only letters, digits and + - * / < > = ! . , : | ^ ( ) and spaces (no braces, quotes or %%)", name)}
	}
	return nil
}
