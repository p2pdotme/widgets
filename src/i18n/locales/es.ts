import type { Messages } from "./en";

/** Spanish (LATAM-neutral) message catalog. */
export const es: Messages = {
  common: {
    copy: "Copiar",
    copied: "Copiado",
    close: "Cerrar",
    cancel: "Cancelar",
    continue: "Continuar",
    done: "Listo",
    tryAgain: "Intentar de nuevo",
    retry: "Reintentar",
    send: "Enviar",
    sending: "Enviando…",
    loadingQuote: "Cargando cotización…",
    rateUnavailable: "Tasa no disponible",
    demo: "DEMO",
    you: "Tú",
    support: "Soporte",
    payment: "Pago",
    paymentId: "ID de pago",
    paymentAddressFallback: "dirección de pago",
    paymentAppFallback: "pago",
    yourOrder: "tu pedido",
    alpha: "Alpha",
    orderHash: "Pedido #{orderId}",
    amount: "Monto",
    order: "Pedido",
    usdcSuffix: "{amount} USDC",
    left: "restante",
    expired: "expirado",
  },

  stepper: {
    matching: "Emparejando",
    payment: "Pago",
    complete: "Completo",
  },

  checkout: {
    title: "Checkout P2P",
    orderSummary: "Resumen del pedido",
    payWith: "Pagar con",
    subtotal: "Subtotal",
    order: "Pedido",
    creditApplied: "Crédito aplicado",
    creditAppliedUsdc: "({creditUsdc} USDC)",
    transactionFee: "Comisión de transacción",
    waivedAbove: "Exenta en pedidos superiores a {thresholdLabel}.",
    youPay: "Pagas",
    freeCreditCovers: "Gratis (cubierto por crédito)",
    payNow: "Pagar ahora",
    payAmount: "Pagar {symbol} {total}",
    redeemCredit: "Canjear crédito",
    amountTooSmall: "Monto demasiado bajo",
    rateUnavailable: "Tasa no disponible",
    tooSmallBody:
      "Este monto es demasiado bajo para procesarlo{feeClause}. Usa un monto mayor.",
    tooSmallFeeClause: " — no cubre la comisión de {feeFiatLabel}",
    tooSmallInline:
      "Este monto es demasiado bajo para procesarlo — no cubre la comisión de transacción. Usa un monto mayor.",
    rateLoadFailed:
      "No se pudo cargar el tipo de cambio para cotizar este pedido. Actualiza e inténtalo de nuevo.",
    rateStillLoading:
      "Aún se está cargando el tipo de cambio — espera un momento e inténtalo de nuevo.",
    livenessIncomplete:
      "La verificación no se completó. Inténtalo de nuevo.",
    localCurrencyHint:
      "Pagarás en tu moneda local para completar este pedido.",

    livenessTitle: "Verificación rápida",
    livenessSubtitle:
      "Para mantener todo justo, verifica que eres una persona real. Toma unos segundos y solo lo haces una vez.",
    verifyHuman: "Verificar que soy humano",
    verifying: "Verificando…",

    pendingTitle: "Termina tu pedido pendiente primero",
    pendingSubtitle:
      "Completa o cancela tu pedido pendiente antes de crear otro.",
    pendingOrder: "Pedido pendiente",
    resumeThatOrder: "Reanudar ese pedido",

    placingTitle: "Creando pedido…",
    placingSubtitle: "Esperando la confirmación de tu transacción.",

    matchingTitle: "Emparejando tu pedido",
    matchingSubtitle:
      "Pedido #{orderId}: Estamos emparejando tu pago en efectivo con alguien que entregará USDC para este checkout. Suele tardar 2-3 minutos.",

    payExactly: "Paga exactamente",
    forProduct: "por {productName}",
    forUsdc: "por {usdc} USDC",
    forYourOrder: "por tu pedido",
    viewBreakdown: "Ver desglose",
    hideBreakdown: "Ocultar desglose",
    totalPaid: "Total pagado",
    payViaAndConfirm: "Paga vía {paymentMethod} y confirma",

    step1SendAmount: "Envía {currency} {fiat}",
    step1SendPayment: "Envía el pago",
    step1Subtitle:
      "A la {paymentAddressLabel} de abajo, desde cualquier app de {paymentMethod}.",
    decrypting: "Descifrando datos de pago…",

    copyPixCode: "Copiar código Pix (Copia e Cola)",
    pixCodeCopied: "Código Pix copiado",
    qrScanLead: "Escanea con la app de cámara para copiar el {label} — ",
    qrNotPayable: "No es un QR de pago",

    backFromAppNudge:
      "¿Volviste de tu app de {paymentMethod}? Si enviaste {currency} {fiat}, confirma abajo — el pedido no se liquida hasta que lo hagas.",
    backFromAppNudgeNoAmount:
      "¿Volviste de tu app de {paymentMethod}? Si ya enviaste el pago, confirma abajo — el pedido no se liquida hasta que lo hagas.",
    confirmTitle: "Confirma que pagaste",
    confirmSubtitle:
      "No podemos ver tu transferencia — tu pedido permanece abierto hasta que pulses abajo.",
    windowClosedTitle: "Esta ventana de pago se cerró",
    iveSent: "Envié {currency} {fiat}",
    iveMadePayment: "Ya realicé el pago",
    confirming: "Confirmando…",
    paymentWindowClosed: "Ventana de pago cerrada",
    confirmWithin:
      "Confirma en {countdown} o el pedido se cancela automáticamente.",
    alreadySentDontResend: "¿Ya enviaste el dinero? No lo envíes de nuevo.",
    windowExpiredBody:
      "Este pedido ya no se puede confirmar on-chain. Contacta soporte con el número de pedido y se resolverá.",
    cancelOrder: "Cancelar pedido",
    cancelConfirm: "¿Cancelar este pedido?",
    yesCancel: "Sí, cancelar",
    cancelling: "Cancelando…",
    keepOrder: "Mantener pedido",
    stickyBackConfirm:
      "¿Volviste de tu app de {paymentMethod}? Confirma para liquidar tu pedido.",
    stickyStep2: "Paso 2 · Confirma cuando hayas pagado",

    verifyingTitle: "Verificando tu pago",
    verifyingSubtitle: "Confirmando la recepción. Suele tardar menos de un minuto.",
    paymentComplete: "Pago completo",
    creditRedeemed: "Crédito canjeado",
    creditOnlyBody:
      "Pedido cubierto con tu crédito existente. No se cobró fiat.",
    usdcDelivered: "{usdc} USDC entregados.",
    orderCancelled: "Pedido cancelado",
    notCharged: "No se te cobró.",
  },

  cashout: {
    title: "Retiro P2P",
    youllReceive: "Recibirás",
    amountToWithdraw: "Monto a retirar",
    placeholderAmount: "0.00",
    balance: "Saldo: {balance} USDC",
    loadingBalance: "Cargando saldo…",
    max: "Máx",
    insufficientBalance: "Saldo USDC insuficiente.",
    receiveIn: "Recibir en",
    youReceive: "Recibes",
    youSell: "Vendes",
    for: "Por",
    serviceFee: "Comisión de servicio",
    feePlusUsdc: "+ {fee} USDC",
    waivedAbove: "Exenta en pedidos superiores a {thresholdLabel}.",
    totalCharged: "Total cobrado",
    withdraw: "Retirar",
    withdrawAmount: "Retirar {symbol} {receive}",
    payoutTooSmall: "Retiro demasiado bajo",
    payoutTooSmallBody:
      "Este retiro es demasiado bajo. Usa un monto mayor.",
    rateLoadFailed:
      "No se pudo cargar el tipo de cambio para este retiro. Inténtalo de nuevo.",

    submittingTitle: "Enviando retiro…",
    submittingSubtitle:
      "Configurando tu retiro. Confirma los avisos de la billetera.",

    matchingTitle: "Emparejando tu pedido",
    matchingSubtitle:
      "Pedido #{orderId}: Estamos emparejando tu retiro de {usdc} USDC con alguien que pagará{currencyClause} a tu {paymentMethod}. Suele tardar 2-3 minutos.",
    matchingSubtitleAccount:
      "Pedido #{orderId}: Estamos emparejando tu retiro de {usdc} USDC con alguien que pagará{currencyClause} a tu cuenta. Suele tardar 2-3 minutos.",

    sendingDetailsTitle: "Enviando datos de pago",
    sendingDetailsSubtitle: "Compartiendo tus datos de cobro de forma segura.",
    receiveTo: "Recibir en",

    paymentInProgress: "Pago en curso",
    watchForArrival:
      "Espera {symbol} {fiat} vía {paymentMethod}.",
    watchForFiat: "Espera a que el fiat llegue a tu cuenta.",

    withdrawn: "¡Retirado!",
    receivedFor:
      "Recibiste {symbol} {fiat} por {usdc} USDC.",
    paidTo: "Pagado a",

    orderCancelled: "Pedido cancelado",
    cancelledSubtitle:
      "El pedido se canceló y tus fondos fueron devueltos. Puedes intentarlo de nuevo cuando quieras.",

    deliverFailedTitle: "No se pudieron entregar los datos de pago",
    deliverFailedBody:
      "Tu orden de offramp sigue activa on-chain (#{orderId}). El merchant aceptó; no pudimos entregar tu dirección de pago cifrada. Reintentar vuelve a cifrar y entregar contra el mismo pedido.",
    retryDelivery: "Reintentar entrega",

    placeFailedTitle: "No se pudo crear el retiro",
    backToForm: "Volver al formulario",
  },

  history: {
    pendingOrders: "Pedidos pendientes",
    orderHistory: "Historial de pedidos",
    refresh: "Actualizar",
    refreshing: "Actualizando…",
    loadingTitle: "Cargando pedidos",
    loadingSubtitle: "Consultando el subgraph…",
    fetchFailed: "Error al obtener pedidos",
    noPending: "No hay pedidos pendientes.",
    noOrders: "Aún no hay pedidos.",
    pending: "Pendientes",
    past: "Anteriores",
    resume: "Reanudar",
    justNow: "ahora",
    minutesAgo: "hace {n} min",
    hoursAgo: "hace {n} h",
    daysAgo: "hace {n} d",

    statusMatching: "Emparejando",
    statusAwaitingPayment: "Esperando pago",
    statusVerifying: "Verificando",
    statusCompleted: "Completado",
    statusCancelled: "Cancelado",
    disputeInSupport: "En soporte",
    disputeResolved: "Soporte resuelto",
  },

  orderAction: {
    resumeOrder: "Reanudar pedido",
    underReview: "En revisión",
    resolved: "Resuelto",
    placedMatching: "Creado · emparejando",
    placedStale:
      "Creado · aún emparejando, está tardando más de lo habitual",
    acceptedAwaitingPayment: "Aceptado · esperando tu pago",
    acceptedProcessing: "Aceptado · procesando pago",
    paidProcessing: "Pagado · procesando pago",
    paidTakingLonger:
      "Pagado · procesando pago · tardando más de lo habitual",
    paidWillResolveWithin:
      "Pagado · procesando pago · se resolverá en {remaining}",
    paymentReceivedConfirm: "Pago recibido · confirma para completar",
    completed: "Completado",
    completedReviewClosed: "Completado · ventana de revisión cerrada",
    cancelled: "Cancelado",
    cancelledContactSupport:
      "Cancelado · contacta soporte para recuperar fondos",
    cancelledReviewClosed: "Cancelado · ventana de revisión cerrada",
    reviewOpensIn: "{label} · la revisión abre en {remaining}",
    statusUnavailable: "Estado no disponible",
    remainingSeconds: "{n}s",
    remainingMinutes: "{n}m",
    remainingHoursMinutes: "{h}h {m}m",
    remainingDaysHours: "{d}d {h}h",
  },

  support: {
    getHelp: "Obtener ayuda",
    viewReport: "Ver reporte",
    viewResolution: "Ver resolución",
    continueSupport: "Continuar soporte",
    openSupportAria: "Abrir soporte",
    closeSupportAria: "Cerrar soporte",
    orderSupportAria: "Soporte del pedido",
    title: "Soporte",
    orderLabel: "Pedido {shortId}",
    openedFrom:
      "Abierto desde {originApp}. No se comparten nombres ni direcciones de billetera con la otra parte.",
    defaultOriginApp: "esta app",

    signingTitle: "Iniciando sesión",
    signingBody:
      "Aprueba la solicitud de mensaje en tu billetera para abrir soporte de este pedido.",
    loadingChatTitle: "Cargando chat",
    loadingChatBody: "Conectando con el equipo de soporte de pagos...",

    unavailableTitle: "Soporte aún no disponible",
    unavailableBody:
      "Tu pedido debe ser aceptado antes de abrir un hilo de soporte. Inténtalo en un momento, o vuelve cuando el pedido esté Aceptado.",

    registeredTitle: "Solicitud de soporte registrada",
    registeredBody:
      "Tu solicitud va camino al equipo de soporte. Cualquier fondo retenido se reembolsará al resolverse. Vuelve aquí en un rato para ver el estado.",

    errUserRejectedTitle: "Autorización cancelada",
    errUserRejectedBody:
      "Rechazaste el inicio de sesión. Pulsa Reintentar para firmar y abrir soporte.",
    errNetworkTitle: "Problema de conexión",
    errNetworkBody:
      "No pudimos alcanzar el servicio de soporte. Revisa tu conexión e inténtalo de nuevo.",
    errAuthTitle: "Error de inicio de sesión",
    errAuthBody:
      "No pudimos verificar tu billetera. Inténtalo de nuevo o reconéctala si el problema continúa.",
    errChatwootTitle: "El chat no cargó",
    errChatwootBody:
      "El widget de chat de soporte no cargó. Actualiza la página o inténtalo de nuevo.",
    errUnknownTitle: "Algo salió mal",
    errUnknownBody: "No pudimos abrir soporte. Inténtalo en un momento.",

    activeSupport: "Soporte activo",
    activeSupportAria: "Conversación de soporte activa",
    activeSupportTitle:
      "Tienes una conversación de soporte activa en este pedido",
  },

  report: {
    contactSupport: "Contactar soporte",
    contactSupportCountdown: "Contactar soporte · {remaining}",
    confirmTitle: "Contactar soporte",
    confirmIntro: "Antes de continuar, ten en cuenta:",
    confirmBullet1:
      "Debes haber pagado ya el pedido. La revisión necesita los datos del comprobante.",
    confirmBullet2:
      "El equipo revisará ambas partes. La resolución suele tardar de 24 a 72 horas.",
    confirmBullet3:
      "Los reportes de mala fe pueden afectar tu reputación. Solo reporta si tu pedido pagado no se completó.",

    formTitle: "Confirmar datos de la transacción",
    formBody:
      "Pedido #{shortId}. Ingresa los últimos 4 dígitos del id de transacción que usaste para pagar. Esto ayuda al soporte a cruzar tu pago con los registros de la otra parte. Al enviar se abre el hilo de soporte.",
    last4Label: "Últimos 4 dígitos",
    last4Aria: "últimos 4 dígitos del id de transacción",
    last4Error: "Ingresa los últimos 4 dígitos del id de transacción.",
    submit: "Enviar",
    submitting: "Enviando…",

    submittedTitle: "Solicitud de soporte registrada",
    submittedBody:
      "Tu solicitud va camino al equipo de soporte. Cualquier fondo retenido se reembolsará al resolverse. Vuelve aquí en un rato para ver el estado.",

    errorTitle: "No se pudo enviar el reporte",
    unknownError: "Error desconocido.",

    revertNotAuthorized:
      "Solo la billetera que creó el pedido puede contactar soporte.",
    revertDisputeTimeNotReached:
      "El soporte aún no está disponible — espera unos minutos e inténtalo de nuevo.",
    revertDisputeTimeExpired:
      "La ventana de revisión de este pedido se cerró.",
    revertInvalidOrderStatus:
      "Este pedido aún no admite un reporte. Espera a que expire o se complete.",
    revertCannotRaiseTwice:
      "Ya se presentó un reporte en este pedido.",
    revertAlreadySettled:
      "El reporte de este pedido ya fue resuelto.",
    revertInvalidOrderType:
      "Los reportes no están disponibles para este tipo de pedido.",
  },

  userSupport: {
    reconnectHint: "Tu sesión de soporte necesita reconectarse.",
    reconnecting: "Reconectando…",
    reconnect: "Reconectar",
    loadingConversation: "Cargando conversación…",
    empty:
      "Aún no hay mensajes. Envía uno y el equipo de soporte responderá aquí.",
    loadFailed: "No se pudo cargar la conversación. Reintentando…",
    closedBySupport: "Esta conversación fue cerrada por soporte.",
    messageAria: "Mensaje",
    placeholder: "Escribe un mensaje…",
    authFailed: "No pudimos verificar tu billetera para soporte.",
    sendConversationNotReady:
      "El soporte aún no está listo. Inténtalo en un momento.",
    sendTooLong: "El mensaje es demasiado largo (máx. {max} caracteres).",
    sendEmpty: "Escribe un mensaje primero.",
    sendUnavailable:
      "El soporte no está disponible temporalmente. Inténtalo pronto.",
    sendFailed: "No se pudo enviar tu mensaje. Inténtalo de nuevo.",
  },

  opsSupport: {
    p2pTag: "Etiqueta P2P",
    p2pTagAria: "Etiqueta P2P",
    clearTag: "Borrar",
    tagAwaitingUser: "Esperando usuario",
    tagReviewing: "Revisando",
    tagEvidence: "Evidencia",
    tagEscalated: "Escalado",
    noConversation: "Sin conversación",
    statusOpen: "abierto",
    statusPending: "pendiente",
    statusSnoozed: "pospuesto",
    statusResolved: "resuelto",
    loadingConversation: "Cargando conversación…",
    noMessages: "Aún no hay mensajes.",
    loadFailed: "No se pudo cargar la conversación. Reintentando…",
    resolvedFooter:
      "Esta conversación está resuelta. Pon el estado en abierto para responder.",
    replyAria: "Responder",
    replyPlaceholder: "Escribe una respuesta…",
    resolveChat: "Resolver chat",
    resolveTitle: "¿Resolver este chat?",
    resolveBody:
      "La entrada del usuario queda bloqueada y verá un aviso de \"chat cerrado\". Pon el estado en abierto para volver a responder.",
    resolve: "Resolver",
    resolving: "Resolviendo…",
    customer: "Cliente",
    orderLabel: "Pedido {shortId}",
  },

  p2pTag: {
    chatClosedBySupport: "Chat cerrado por soporte",
    awaitingUser: "Esperando tu respuesta",
    reviewing: "Nuestro equipo está revisando",
    evidence: "Necesitamos un poco más de información",
  },

  paymentAddress: {
    encryptedHint:
      "Cifrado y compartido de forma segura cuando tu pedido sea aceptado.",
    required: "{label} obligatorio",
    labelUpi: "Identificador UPI",
    labelPix: "Clave PIX",
    labelIban: "IBAN",
    labelBankAccount: "Cuenta bancaria",
    labelPayNow: "PayNow ID",
    labelClabe: "CLABE",
    labelFallback: "Dirección de pago",
    placeholderInr: "nombre@upi",
    placeholderBrl: "Clave PIX (CPF, email, teléfono o aleatoria)",
    placeholderEur: "IBAN (ej. DE89370400440532013000)",
    placeholderUsd: "Número de cuenta bancaria",
    placeholderSgd: "PayNow ID",
    placeholderMxn: "CLABE de 18 dígitos",
    placeholderFallback: "Dirección de pago",
    errUpi: "El UPI debe verse como nombre@banco (ej. ejemplo@upi)",
    errPixRequired:
      "Clave PIX obligatoria (CPF, CNPJ, email, teléfono o clave aleatoria)",
    errPixInvalid: "Clave PIX inválida",
    errIban: "Formato IBAN: CC## + alfanuméricos (sin espacios)",
    errUsd: "Número de cuenta obligatorio (solo dígitos)",
    errSgd: "PayNow ID obligatorio (NRIC, móvil o UEN)",
    errMxn: "La CLABE debe tener 18 dígitos",
    errFallback: "Dirección de pago obligatoria",
    errCpf: "La clave CPF debe tener 11 dígitos, recibió {n}: {raw}",
    errCnpj: "La clave CNPJ debe tener 14 dígitos, recibió {n}: {raw}",
    errPhone:
      "La clave de teléfono debe resolver a +55 + área + número, recibió: {raw}",
    errEmail: "Email inválido: {raw}",
    errEvp: "Clave aleatoria/EVP inválida, se esperaba UUID: {raw}",
  },

  currency: {
    UPI_ID: "UPI ID",
    PIX_ID: "PIX ID",
    ALIAS_ID: "Alias",
    CLABE_ID: "CLABE",
    PHONE_NUMBER: "número de teléfono",
    ACCOUNT_NUMBER: "número de cuenta",
    PAGO_MOVIL_DETAILS: "Datos de Pago Móvil",
    PHONE_NUMBER_FIELD: "Número de teléfono",
    ACCOUNT_NUMBER_FIELD: "Número de cuenta",
    ACCOUNT_NUMBER_LABEL: "Número de cuenta",
    BANK_NAME_LABEL: "Nombre del banco",
    BANK_LABEL: "Banco",
    RIF_LABEL: "RIF",
    paymentFallback: "Pago",
  },

  errors: {
    walletRejected:
      "La transacción fue rechazada en tu billetera. Apruébala para continuar.",
    walletInsufficient:
      "Tu billetera no tiene fondos suficientes para esta transacción (incluido el gas).",
    revertUnknown:
      "La transacción revirtió on-chain por un motivo no reconocido. Inténtalo de nuevo o contacta soporte.",
    revertNamedFallback:
      "La transacción revirtió on-chain ({name}).",
    networkTimeout:
      "La red responde lento. Inténtalo de nuevo en un momento.",
    networkUnreachable:
      "No se pudo alcanzar la red. Revisa tu conexión e inténtalo de nuevo.",
    unknown: "Algo salió mal. Inténtalo de nuevo.",

    noMerchants:
      "No se encontraron merchants P2P elegibles para esta transacción.",
    missingRouting:
      "Este widget no tiene la configuración necesaria para encontrar un merchant. Contacta al dueño del sitio.",
    encryptionPreflight:
      "No se pudo inicializar el mensajería segura. Recarga la página — si sigue fallando, contacta soporte.",
    encryptionFailed:
      "No se pudieron cifrar tus datos de pago. Inténtalo de nuevo — si persiste, contacta soporte.",
    orderBadStatus:
      "Este pedido ya avanzó y no se puede reintentar desde aquí. Actualiza para ver su estado.",
    screeningApi:
      "La verificación antifraude no está disponible temporalmente. Tu pedido puede continuar.",
    screeningRestricted:
      "Detectamos actividad inusual — espera un momento mientras aplicamos una actualización menor",
    screeningRejected:
      "Este pedido no puede procesarse. Contacta soporte si crees que es un error.",
    livenessRequired:
      "Se requiere una verificación rápida antes de continuar.",

    b2bProxyMismatch:
      "Esta ruta de pago está mal configurada. Contacta soporte — la dirección del integrador on-chain no coincide con la registrada.",
    b2bIntegratorInactive:
      "Esta ruta de pago no está disponible. Inténtalo más tarde — el integrador fue desactivado on-chain.",
    b2bRejectedOrder:
      "El integrador del merchant rechazó este pedido. Puede que hayas alcanzado un límite por tx, por usuario o diario.",
    b2bCallerNotContract:
      "La transacción se envió desde una dirección no admitida. Esto no debería ocurrir en un checkout normal — repórtalo.",
    b2bProxyBadState:
      "El proxy on-chain está en mal estado. Contacta soporte.",
    b2bProxyOwnerZero:
      "El proxy on-chain no está inicializado. Contacta soporte.",
    b2bProxyImplLocked:
      "Este integrador se registró con otra plantilla de proxy y no se puede actualizar en el lugar.",
    notEnoughMerchants:
      "No se encontraron merchants P2P elegibles para esta transacción.",
    exchangeNotOperational:
      "El exchange P2P está temporalmente deshabilitado. Inténtalo más tarde.",
    userBlacklisted:
      "Esta billetera está bloqueada para crear pedidos. Contacta soporte si crees que es un error.",
    zeroReputation:
      "Tu cuenta aún no tiene la reputación requerida para este pedido.",
    orderExpired: "Este pedido expiró. Empieza uno nuevo.",
    invalidAddress: "Se rechazó una dirección on-chain como inválida.",
    invalidAmount: "El monto del pedido se rechazó como inválido on-chain.",
    currencyNotSupported:
      "Esta moneda no está soportada on-chain actualmente.",
    usdtTransferFailed:
      "Falló la transferencia USDC — confirma saldo + allowance e inténtalo de nuevo.",
    dailyBuyLimit: "Alcanzaste el límite diario de compras. Inténtalo mañana.",
    monthlyBuyLimit:
      "Alcanzaste el límite mensual de compras. Inténtalo el próximo mes.",
    dailyPlacementLimit:
      "Has creado demasiados pedidos hoy. Inténtalo más tarde.",
    buyAmountLimit:
      "El monto de compra supera el límite por pedido del protocolo.",
    sellAmountLimit:
      "El monto de venta supera el límite por pedido del protocolo.",
    dailyVolume: "Alcanzaste el límite de volumen de hoy. Inténtalo mañana.",
    yearlyVolume: "Alcanzaste el límite de volumen de este año.",
    upiAlreadySent:
      "Los datos de pago ya se enviaron para este pedido.",
    invalidOrderUpi:
      "Tu dirección de pago no pudo ser aceptada por el protocolo.",
    orderAlreadyCancelled: "Este pedido ya fue cancelado.",
  },
};
