// Shared Indian Rupee formatter, extracted from the Payments page so the
// Dashboard and Reports surfaces render currency identically (Req 8.3, 9.7).
export const inr = (n: number) => "₹" + Number(n).toLocaleString("en-IN");
