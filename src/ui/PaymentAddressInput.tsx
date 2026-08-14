import React, { useState, useEffect } from "react";
import { color, radius, font, weight, S } from "./theme";
import {
  getValidatorFor,
  getPlaceholderFor,
  getPaymentLabelFor,
} from "../core/currencies";
import { resolveCurrencyMeta } from "../core/currency-meta";
import type { CurrencyOption } from "../types";
import { useI18n, useT } from "../i18n";

export interface PaymentAddressInputProps {
  currency: CurrencyOption;
  value: string;
  onChange: (next: string) => void;
  /** Bubbles up validity so the parent can disable submit. */
  onValidityChange?: (isValid: boolean) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

export function PaymentAddressInput(props: PaymentAddressInputProps) {
  const { currency, value, onChange, onValidityChange, disabled, autoFocus } = props;
  const t = useT();
  const { locale } = useI18n();
  const [touched, setTouched] = useState(false);

  const validator = getValidatorFor(
    currency.symbol,
    currency.validatePaymentAddress,
    locale,
  );
  const placeholder = getPlaceholderFor(
    currency.symbol,
    currency.paymentAddressPlaceholder,
    locale,
  );
  const label = getPaymentLabelFor(currency.symbol, locale);
  const paymentMethod = resolveCurrencyMeta(currency, locale).paymentMethod;

  const error = value.length > 0 ? validator(value) : null;
  const isEmpty = value.trim().length === 0;
  const isValid = !isEmpty && error === null;

  useEffect(() => { onValidityChange?.(isValid); }, [isValid, onValidityChange]);

  const showError = touched && (isEmpty || error !== null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ ...S.label, color: color.textMuted }}>
        {label}
        <span style={{ marginLeft: 6, color: color.textFaint, textTransform: "none", letterSpacing: 0 }}>
          ({paymentMethod})
        </span>
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        style={{
          width: "100%", boxSizing: "border-box",
          height: 44,
          padding: "0 12px",
          background: color.surface,
          border: `1px solid ${showError ? color.danger : color.border}`,
          borderRadius: radius.md,
          fontSize: font.base,
          fontWeight: weight.medium,
          color: color.text,
          outline: "none",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      />
      <div style={{ minHeight: 16, fontSize: font.sm }}>
        {showError ? (
          <span style={{ color: color.danger }}>
            {isEmpty ? t("paymentAddress.required", { label }) : error}
          </span>
        ) : (
          <span style={{ color: color.textFaint }}>
            {t("paymentAddress.encryptedHint")}
          </span>
        )}
      </div>
    </div>
  );
}
