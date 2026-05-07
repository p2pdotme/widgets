export interface CurrencyConfig {
  symbol: string;
  name: string;
  flag: string;
  paymentMethod: string;
  hasQR: boolean;
  circleId: number;
  compoundFields?: readonly string[];
}

export const CURRENCIES: CurrencyConfig[] = [
  { symbol: "INR", name: "Indian Rupee", flag: "🇮🇳", paymentMethod: "UPI", hasQR: true, circleId: 1 },
  { symbol: "IDR", name: "Indonesian Rupiah", flag: "🇮🇩", paymentMethod: "QRIS", hasQR: false, circleId: 1 },
  { symbol: "BRL", name: "Brazilian Real", flag: "🇧🇷", paymentMethod: "PIX", hasQR: false, circleId: 2 },
  { symbol: "ARS", name: "Argentine Peso", flag: "🇦🇷", paymentMethod: "Alias", hasQR: false, circleId: 1 },
  { symbol: "MEX", name: "Mexican Peso", flag: "🇲🇽", paymentMethod: "SPEI", hasQR: false, circleId: 1 },
  { symbol: "VEN", name: "Venezuelan Bolivar", flag: "🇻🇪", paymentMethod: "Pago Movil", hasQR: false, circleId: 1,
    compoundFields: ["Phone", "RIF", "Bank"] },
  { symbol: "NGN", name: "Nigerian Naira", flag: "🇳🇬", paymentMethod: "NIP", hasQR: false, circleId: 1,
    compoundFields: ["Account Number", "Bank Name"] },
];

export const DEMO_FIAT_RATE: Record<string, number> = {
  INR: 83, IDR: 15800, BRL: 5, ARS: 900, MEX: 17, VEN: 36, NGN: 1500,
};
