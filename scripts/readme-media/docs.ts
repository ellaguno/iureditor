// Fictional demo documents shown in the README media (no real data).
export const DIR = '/home/demo/Documents/Ruiz';

export const DOCS: Record<'en' | 'es', Record<string, string>> = {
  en: {
    'Service agreement.md': `# Service agreement

**Client:** Despacho Ruiz & Asociados · **Provider:** Ana Torres Consulting · **Date:** October 1, 2026

## 1. Scope

The Provider will audit the Client's standard contracts, update the templates and train the legal team.

## 2. Fees and schedule

| Milestone | Deliverable | Due | Fee (USD) |
|---|---|---|---|
| 1 | Contract audit | Oct 15 | 2,400 |
| 2 | Updated templates | Nov 5 | 3,100 |
| 3 | Team training | Nov 20 | 1,500 |

## 3. Approval workflow

\`\`\`mermaid
flowchart LR
  A[Draft] --> B[Internal review]
  B --> C{Client approves?}
  C -- Yes --> D[Signature]
  C -- No --> A
\`\`\`

## 4. Confidentiality

Both parties keep all case information confidential during the agreement and for two years after it ends.

## 5. Termination

Either party may end the agreement with 15 days' written notice; completed milestones are paid in full.
`,
    'Late-payment interest.md': `# Late-payment interest

Under clause 7 of the service agreement, overdue invoices accrue simple interest[^1] at the annual rate $r$ for each day $d$ of delay:

$$I = P \\cdot r \\cdot \\frac{d}{365}$$

For the second milestone (USD 3,100) paid 45 days late at $r = 12\\%$, the interest is $I \\approx 45.86$ USD.

If the parties agree to monthly compounding[^2], the amount due after $m$ months is:

$$A = P\\left(1 + \\frac{r}{12}\\right)^{m}$$

## Summary

- Simple interest is the default.
- Compounding needs written agreement.
- Interest stops on the day of payment.

[^1]: Rate set in clause 7.2 of the agreement.
[^2]: Only if both parties sign an addendum.
`,
    'Meeting notes.md': `# Kick-off meeting

- Attendees: Ana Torres, Luis Ruiz
- Next step: send the contract audit by October 15
`,
  },
  es: {
    'Contrato de servicios.md': `# Contrato de prestación de servicios

**Cliente:** Despacho Ruiz & Asociados · **Prestadora:** Ana Torres Consultoría · **Fecha:** 1 de octubre de 2026

## 1. Objeto

La Prestadora revisará los contratos tipo del Cliente, actualizará las plantillas y capacitará al equipo jurídico.

## 2. Honorarios y calendario

| Etapa | Entregable | Fecha | Honorarios (MXN) |
|---|---|---|---|
| 1 | Auditoría de contratos | 15 oct | 42,000 |
| 2 | Plantillas actualizadas | 5 nov | 54,000 |
| 3 | Capacitación del equipo | 20 nov | 26,000 |

## 3. Flujo de aprobación

\`\`\`mermaid
flowchart LR
  A[Borrador] --> B[Revisión interna]
  B --> C{¿Aprueba el cliente?}
  C -- Sí --> D[Firma]
  C -- No --> A
\`\`\`

## 4. Confidencialidad

Ambas partes guardarán confidencialidad sobre la información de los asuntos durante la vigencia y dos años después.

## 5. Terminación

Cualquiera de las partes puede darlo por terminado con aviso por escrito de 15 días; las etapas concluidas se pagan completas.
`,
    'Intereses moratorios.md': `# Intereses moratorios

Conforme a la cláusula 7 del contrato, las facturas vencidas generan interés simple[^1] a la tasa anual $r$ por cada día $d$ de atraso:

$$I = P \\cdot r \\cdot \\frac{d}{365}$$

Para la segunda etapa (54,000 MXN) pagada con 45 días de atraso a $r = 12\\%$, el interés es $I \\approx 798.90$ MXN.

Si las partes pactan capitalización mensual[^2], el monto adeudado tras $m$ meses es:

$$A = P\\left(1 + \\frac{r}{12}\\right)^{m}$$

## Resumen

- El interés simple es la regla general.
- La capitalización requiere pacto por escrito.
- El interés deja de correr el día del pago.

[^1]: Tasa fijada en la cláusula 7.2 del contrato.
[^2]: Sólo si ambas partes firman un convenio modificatorio.
`,
    'Notas de la reunión.md': `# Reunión de arranque

- Asistentes: Ana Torres, Luis Ruiz
- Siguiente paso: enviar la auditoría de contratos antes del 15 de octubre
`,
  },
};
