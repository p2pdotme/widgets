import type { Messages } from "./en";

/** Brazilian Portuguese message catalog. */
export const ptBR: Messages = {
  common: {
    copy: "Copiar",
    copied: "Copiado",
    close: "Fechar",
    cancel: "Cancelar",
    continue: "Continuar",
    done: "Concluído",
    tryAgain: "Tentar de novo",
    retry: "Tentar novamente",
    send: "Enviar",
    sending: "Enviando…",
    loadingQuote: "Carregando cotação…",
    rateUnavailable: "Cotação indisponível",
    demo: "DEMO",
    you: "Você",
    support: "Suporte",
    payment: "Pagamento",
    paymentId: "ID do pagamento",
    paymentAddressFallback: "endereço de pagamento",
    paymentAppFallback: "pagamento",
    yourOrder: "seu pedido",
    alpha: "Alpha",
    orderHash: "Pedido #{orderId}",
    amount: "Valor",
    order: "Pedido",
    usdcSuffix: "{amount} USDC",
    left: "restante",
    expired: "expirado",
  },

  stepper: {
    matching: "Pareando",
    payment: "Pagamento",
    complete: "Concluído",
  },

  checkout: {
    title: "Checkout P2P",
    orderSummary: "Resumo do pedido",
    payWith: "Pagar com",
    subtotal: "Subtotal",
    order: "Pedido",
    creditApplied: "Crédito aplicado",
    creditAppliedUsdc: "({creditUsdc} USDC)",
    transactionFee: "Taxa de transação",
    waivedAbove: "Isenta em pedidos acima de {thresholdLabel}.",
    youPay: "Você paga",
    freeCreditCovers: "Grátis (coberto pelo crédito)",
    payNow: "Pagar agora",
    payAmount: "Pagar {symbol} {total}",
    redeemCredit: "Resgatar crédito",
    amountTooSmall: "Valor muito baixo",
    rateUnavailable: "Cotação indisponível",
    tooSmallBody:
      "Este valor é muito baixo para processar{feeClause}. Use um valor maior.",
    tooSmallFeeClause: " — não cobre a taxa de {feeFiatLabel}",
    tooSmallInline:
      "Este valor é muito baixo para processar — não cobre a taxa de transação. Use um valor maior.",
    rateLoadFailed:
      "Não foi possível carregar a cotação para precificar este pedido. Atualize e tente de novo.",
    rateStillLoading:
      "Ainda carregando a cotação — aguarde um momento e tente de novo.",
    livenessIncomplete:
      "A verificação não foi concluída. Tente de novo.",
    localCurrencyHint:
      "Você pagará na sua moeda local para concluir este pedido.",

    livenessTitle: "Verificação rápida",
    livenessSubtitle:
      "Para manter tudo justo, confirme que você é uma pessoa real. Leva poucos segundos e você só faz uma vez.",
    verifyHuman: "Verificar que sou humano",
    verifying: "Verificando…",

    pendingTitle: "Finalize seu pedido pendente primeiro",
    pendingSubtitle:
      "Conclua ou cancele seu pedido pendente antes de criar outro.",
    pendingOrder: "Pedido pendente",
    resumeThatOrder: "Retomar esse pedido",

    placingTitle: "Criando pedido…",
    placingSubtitle: "Aguardando a confirmação da sua transação.",

    matchingTitle: "Pareando seu pedido",
    matchingSubtitle:
      "Pedido #{orderId}: Estamos pareando seu pagamento em dinheiro com alguém que entregará USDC neste checkout. Geralmente leva 2-3 minutos.",

    payExactly: "Pague exatamente",
    forProduct: "por {productName}",
    forUsdc: "por {usdc} USDC",
    forYourOrder: "pelo seu pedido",
    viewBreakdown: "Ver detalhamento",
    hideBreakdown: "Ocultar detalhamento",
    totalPaid: "Total pago",
    payViaAndConfirm: "Pague via {paymentMethod} e confirme",

    step1SendAmount: "Envie {currency} {fiat}",
    step1SendPayment: "Envie o pagamento",
    step1Subtitle:
      "Para a {paymentAddressLabel} abaixo, de qualquer app de {paymentMethod}.",
    decrypting: "Descriptografando dados de pagamento…",

    copyPixCode: "Copiar código Pix (Copia e Cola)",
    pixCodeCopied: "Código Pix copiado",
    qrScanLead: "Escaneie com o app de câmera para copiar a {label} — ",
    qrNotPayable: "Não é um QR de pagamento",

    backFromAppNudge:
      "Voltou do app de {paymentMethod}? Se enviou {currency} {fiat}, confirme abaixo — o pedido só liquida quando você confirmar.",
    backFromAppNudgeNoAmount:
      "Voltou do app de {paymentMethod}? Se já enviou o pagamento, confirme abaixo — o pedido só liquida quando você confirmar.",
    confirmTitle: "Confirme que você pagou",
    confirmSubtitle:
      "Não vemos sua transferência — o pedido fica aberto até você tocar abaixo.",
    windowClosedTitle: "Esta janela de pagamento fechou",
    iveSent: "Enviei {currency} {fiat}",
    iveMadePayment: "Já fiz o pagamento",
    confirming: "Confirmando…",
    paymentWindowClosed: "Janela de pagamento fechada",
    confirmWithin:
      "Confirme em {countdown} ou o pedido cancela automaticamente.",
    alreadySentDontResend: "Já enviou o dinheiro? Não envie de novo.",
    windowExpiredBody:
      "Este pedido não pode mais ser confirmado on-chain. Fale com o suporte com o número do pedido e será resolvido.",
    cancelOrder: "Cancelar pedido",
    cancelConfirm: "Cancelar este pedido?",
    yesCancel: "Sim, cancelar",
    cancelling: "Cancelando…",
    keepOrder: "Manter pedido",
    stickyBackConfirm:
      "Voltou do app de {paymentMethod}? Confirme para liquidar seu pedido.",
    stickyStep2: "Passo 2 · Confirme depois de pagar",

    verifyingTitle: "Verificando seu pagamento",
    verifyingSubtitle: "Confirmando o recebimento. Geralmente em menos de um minuto.",
    paymentComplete: "Pagamento concluído",
    creditRedeemed: "Crédito resgatado",
    creditOnlyBody:
      "Pedido cumprido com seu crédito existente. Nenhum fiat foi cobrado.",
    usdcDelivered: "{usdc} USDC entregues.",
    orderCancelled: "Pedido cancelado",
    notCharged: "Você não foi cobrado.",
  },

  cashout: {
    title: "Saque P2P",
    youllReceive: "Você receberá",
    amountToWithdraw: "Valor a sacar",
    placeholderAmount: "0.00",
    balance: "Saldo: {balance} USDC",
    loadingBalance: "Carregando saldo…",
    max: "Máx",
    insufficientBalance: "Saldo USDC insuficiente.",
    receiveIn: "Receber em",
    youReceive: "Você recebe",
    youSell: "Você vende",
    for: "Por",
    serviceFee: "Taxa de serviço",
    feePlusUsdc: "+ {fee} USDC",
    waivedAbove: "Isenta em pedidos acima de {thresholdLabel}.",
    totalCharged: "Total cobrado",
    withdraw: "Sacar",
    withdrawAmount: "Sacar {symbol} {receive}",
    payoutTooSmall: "Saque muito baixo",
    payoutTooSmallBody:
      "Este saque é muito baixo. Use um valor maior.",
    rateLoadFailed:
      "Não foi possível carregar a cotação deste saque. Tente de novo.",

    submittingTitle: "Enviando saque…",
    submittingSubtitle:
      "Configurando seu saque. Confirme os avisos da carteira.",

    matchingTitle: "Pareando seu pedido",
    matchingSubtitle:
      "Pedido #{orderId}: Estamos pareando seu saque de {usdc} USDC com alguém que pagará{currencyClause} no seu {paymentMethod}. Geralmente leva 2-3 minutos.",
    matchingSubtitleAccount:
      "Pedido #{orderId}: Estamos pareando seu saque de {usdc} USDC com alguém que pagará{currencyClause} na sua conta. Geralmente leva 2-3 minutos.",

    sendingDetailsTitle: "Enviando dados de pagamento",
    sendingDetailsSubtitle: "Compartilhando seus dados de recebimento com segurança.",
    receiveTo: "Receber em",

    paymentInProgress: "Pagamento em andamento",
    watchForArrival:
      "Aguarde {symbol} {fiat} via {paymentMethod}.",
    watchForFiat: "Aguarde o fiat chegar na sua conta.",

    withdrawn: "Sacado!",
    receivedFor:
      "Você recebeu {symbol} {fiat} por {usdc} USDC.",
    paidTo: "Pago para",

    orderCancelled: "Pedido cancelado",
    cancelledSubtitle:
      "O pedido foi cancelado e seus fundos foram devolvidos. Você pode tentar de novo a qualquer momento.",

    deliverFailedTitle: "Não foi possível entregar os dados de pagamento",
    deliverFailedBody:
      "Seu pedido de offramp ainda está ativo on-chain (#{orderId}). O merchant aceitou; não conseguimos entregar seu endereço de pagamento criptografado. Tentar de novo refaz a criptografia e a entrega no mesmo pedido.",
    retryDelivery: "Tentar entrega novamente",

    placeFailedTitle: "Não foi possível criar o saque",
    backToForm: "Voltar ao formulário",
  },

  history: {
    pendingOrders: "Pedidos pendentes",
    orderHistory: "Histórico de pedidos",
    refresh: "Atualizar",
    refreshing: "Atualizando…",
    loadingTitle: "Carregando pedidos",
    loadingSubtitle: "Consultando o subgraph…",
    fetchFailed: "Falha ao buscar pedidos",
    noPending: "Nenhum pedido pendente.",
    noOrders: "Ainda não há pedidos.",
    pending: "Pendentes",
    past: "Anteriores",
    resume: "Retomar",
    justNow: "agora",
    minutesAgo: "há {n} min",
    hoursAgo: "há {n} h",
    daysAgo: "há {n} d",

    statusMatching: "Pareando",
    statusAwaitingPayment: "Aguardando pagamento",
    statusVerifying: "Verificando",
    statusCompleted: "Concluído",
    statusCancelled: "Cancelado",
    disputeInSupport: "Em suporte",
    disputeResolved: "Suporte resolvido",
  },

  orderAction: {
    resumeOrder: "Retomar pedido",
    underReview: "Em análise",
    resolved: "Resolvido",
    placedMatching: "Criado · pareando",
    placedStale:
      "Criado · ainda pareando, está demorando mais que o usual",
    acceptedAwaitingPayment: "Aceito · aguardando seu pagamento",
    acceptedProcessing: "Aceito · processando pagamento",
    paidProcessing: "Pago · processando pagamento",
    paidTakingLonger:
      "Pago · processando pagamento · demorando mais que o usual",
    paidWillResolveWithin:
      "Pago · processando pagamento · resolve em {remaining}",
    paymentReceivedConfirm: "Pagamento recebido · confirme para concluir",
    completed: "Concluído",
    completedReviewClosed: "Concluído · janela de análise fechada",
    cancelled: "Cancelado",
    cancelledContactSupport:
      "Cancelado · fale com o suporte para recuperar fundos",
    cancelledReviewClosed: "Cancelado · janela de análise fechada",
    reviewOpensIn: "{label} · análise abre em {remaining}",
    statusUnavailable: "Status indisponível",
    remainingSeconds: "{n}s",
    remainingMinutes: "{n}m",
    remainingHoursMinutes: "{h}h {m}m",
    remainingDaysHours: "{d}d {h}h",
  },

  support: {
    getHelp: "Obter ajuda",
    viewReport: "Ver denúncia",
    viewResolution: "Ver resolução",
    continueSupport: "Continuar suporte",
    openSupportAria: "Abrir suporte",
    closeSupportAria: "Fechar suporte",
    orderSupportAria: "Suporte do pedido",
    title: "Suporte",
    orderLabel: "Pedido {shortId}",
    openedFrom:
      "Aberto de {originApp}. Nomes e endereços de carteira não são compartilhados com a outra parte.",
    defaultOriginApp: "este app",

    signingTitle: "Entrando",
    signingBody:
      "Aprove a solicitação de mensagem na sua carteira para abrir o suporte deste pedido.",
    loadingChatTitle: "Carregando chat",
    loadingChatBody: "Conectando à equipe de suporte de pagamentos...",

    unavailableTitle: "Suporte ainda indisponível",
    unavailableBody:
      "Seu pedido precisa ser aceito antes de abrir um fio de suporte. Tente em um momento, ou volte quando o pedido estiver Aceito.",

    registeredTitle: "Solicitação de suporte registrada",
    registeredBody:
      "Sua solicitação está a caminho da equipe de suporte. Qualquer fundo preso será reembolsado ao resolver. Volte aqui em breve para ver o status.",

    errUserRejectedTitle: "Autorização cancelada",
    errUserRejectedBody:
      "Você recusou o login. Toque em Tentar novamente para assinar e abrir o suporte.",
    errNetworkTitle: "Problema de conexão",
    errNetworkBody:
      "Não foi possível alcançar o serviço de suporte. Verifique sua conexão e tente de novo.",
    errAuthTitle: "Falha no login",
    errAuthBody:
      "Não foi possível verificar sua carteira. Tente de novo ou reconecte se o problema continuar.",
    errChatwootTitle: "O chat não carregou",
    errChatwootBody:
      "O widget de chat de suporte não carregou. Atualize a página ou tente de novo.",
    errUnknownTitle: "Algo deu errado",
    errUnknownBody: "Não foi possível abrir o suporte. Tente em um momento.",

    activeSupport: "Suporte ativo",
    activeSupportAria: "Conversa de suporte ativa",
    activeSupportTitle:
      "Você tem uma conversa de suporte ativa neste pedido",
  },

  report: {
    contactSupport: "Contatar suporte",
    contactSupportCountdown: "Contatar suporte · {remaining}",
    confirmTitle: "Contatar suporte",
    confirmIntro: "Antes de continuar, observe:",
    confirmBullet1:
      "Você já deve ter pago o pedido. A análise precisa dos dados do comprovante.",
    confirmBullet2:
      "A equipe analisará os dois lados. A resolução costuma levar de 24 a 72 horas.",
    confirmBullet3:
      "Denúncias de má-fé podem gerar penalidades de reputação. Só denuncie se seu pedido pago não foi concluído.",

    formTitle: "Confirmar dados da transação",
    formBody:
      "Pedido #{shortId}. Digite os 4 últimos dígitos do id da transação que você usou no pagamento. Isso ajuda o suporte a cruzar seu pagamento com os registros da outra parte. Enviar abre o fio de suporte deste pedido.",
    last4Label: "Últimos 4 dígitos",
    last4Aria: "últimos 4 dígitos do id da transação",
    last4Error: "Digite os 4 últimos dígitos do id da transação.",
    submit: "Enviar",
    submitting: "Enviando…",

    submittedTitle: "Solicitação de suporte registrada",
    submittedBody:
      "Sua solicitação está a caminho da equipe de suporte. Qualquer fundo preso será reembolsado ao resolver. Volte aqui em breve para ver o status.",

    errorTitle: "Não foi possível enviar a denúncia",
    unknownError: "Erro desconhecido.",

    revertNotAuthorized:
      "Só a carteira que criou o pedido pode contatar o suporte.",
    revertDisputeTimeNotReached:
      "O suporte ainda não está disponível — aguarde alguns minutos e tente de novo.",
    revertDisputeTimeExpired:
      "A janela de análise deste pedido fechou.",
    revertInvalidOrderStatus:
      "Este pedido ainda não permite denúncia. Espere expirar ou ser concluído.",
    revertCannotRaiseTwice:
      "Já existe uma denúncia neste pedido.",
    revertAlreadySettled:
      "A denúncia deste pedido já foi resolvida.",
    revertInvalidOrderType:
      "Denúncias não são suportadas neste tipo de pedido.",
  },

  userSupport: {
    reconnectHint: "Sua sessão de suporte precisa reconectar.",
    reconnecting: "Reconectando…",
    reconnect: "Reconectar",
    loadingConversation: "Carregando conversa…",
    empty:
      "Ainda não há mensagens. Envie uma e a equipe de suporte responderá aqui.",
    loadFailed: "Não foi possível carregar a conversa. Tentando de novo…",
    closedBySupport: "Esta conversa foi fechada pelo suporte.",
    messageAria: "Mensagem",
    placeholder: "Escreva uma mensagem…",
    authFailed: "Não foi possível verificar sua carteira para o suporte.",
    sendConversationNotReady:
      "O suporte ainda não está pronto. Tente em um momento.",
    sendTooLong: "A mensagem é longa demais (máx. {max} caracteres).",
    sendEmpty: "Escreva uma mensagem primeiro.",
    sendUnavailable:
      "O suporte está temporariamente indisponível. Tente em breve.",
    sendFailed: "Não foi possível enviar sua mensagem. Tente de novo.",
  },

  opsSupport: {
    p2pTag: "Tag P2P",
    p2pTagAria: "Tag P2P",
    clearTag: "Limpar",
    tagAwaitingUser: "Aguardando usuário",
    tagReviewing: "Em análise",
    tagEvidence: "Evidência",
    tagEscalated: "Escalado",
    noConversation: "Sem conversa",
    statusOpen: "aberto",
    statusPending: "pendente",
    statusSnoozed: "adiado",
    statusResolved: "resolvido",
    loadingConversation: "Carregando conversa…",
    noMessages: "Ainda não há mensagens.",
    loadFailed: "Não foi possível carregar a conversa. Tentando de novo…",
    resolvedFooter:
      "Esta conversa está resolvida. Defina o status como aberto para responder.",
    replyAria: "Responder",
    replyPlaceholder: "Escreva uma resposta…",
    resolveChat: "Resolver chat",
    resolveTitle: "Resolver este chat?",
    resolveBody:
      "A entrada do usuário fica bloqueada e ele vê um aviso de \"chat fechado\". Defina o status como aberto para responder de novo.",
    resolve: "Resolver",
    resolving: "Resolvendo…",
    customer: "Cliente",
    orderLabel: "Pedido {shortId}",
  },

  p2pTag: {
    chatClosedBySupport: "Chat fechado pelo suporte",
    awaitingUser: "Aguardando sua resposta",
    reviewing: "Nossa equipe está analisando",
    evidence: "Precisamos de um pouco mais de informação",
  },

  paymentAddress: {
    encryptedHint:
      "Criptografado e compartilhado com segurança quando seu pedido for aceito.",
    required: "{label} obrigatório",
    labelUpi: "Identificador UPI",
    labelPix: "Chave PIX",
    labelIban: "IBAN",
    labelBankAccount: "Conta bancária",
    labelPayNow: "PayNow ID",
    labelClabe: "CLABE",
    labelFallback: "Endereço de pagamento",
    placeholderInr: "nome@upi",
    placeholderBrl: "Chave PIX (CPF, e-mail, telefone ou aleatória)",
    placeholderEur: "IBAN (ex. DE89370400440532013000)",
    placeholderUsd: "Número da conta bancária",
    placeholderSgd: "PayNow ID",
    placeholderMxn: "CLABE de 18 dígitos",
    placeholderFallback: "Endereço de pagamento",
    errUpi: "O UPI deve parecer nome@banco (ex. exemplo@upi)",
    errPixRequired:
      "Chave PIX obrigatória (CPF, CNPJ, e-mail, telefone ou chave aleatória)",
    errPixInvalid: "Chave PIX inválida",
    errIban: "Formato IBAN: CC## + alfanuméricos (sem espaços)",
    errUsd: "Número da conta obrigatório (somente dígitos)",
    errSgd: "PayNow ID obrigatório (NRIC, celular ou UEN)",
    errMxn: "A CLABE deve ter 18 dígitos",
    errFallback: "Endereço de pagamento obrigatório",
    errCpf: "Chave CPF deve ter 11 dígitos, recebeu {n}: {raw}",
    errCnpj: "Chave CNPJ deve ter 14 dígitos, recebeu {n}: {raw}",
    errPhone:
      "Chave de telefone deve resolver para +55 + DDD + número, recebeu: {raw}",
    errEmail: "E-mail inválido: {raw}",
    errEvp: "Chave aleatória/EVP inválida, esperado UUID: {raw}",
  },

  currency: {
    UPI_ID: "UPI ID",
    PIX_ID: "PIX ID",
    ALIAS_ID: "Alias",
    CLABE_ID: "CLABE",
    PHONE_NUMBER: "número de telefone",
    ACCOUNT_NUMBER: "número da conta",
    PAGO_MOVIL_DETAILS: "Dados do Pago Móvil",
    PHONE_NUMBER_FIELD: "Número de telefone",
    ACCOUNT_NUMBER_FIELD: "Número da conta",
    ACCOUNT_NUMBER_LABEL: "Número da conta",
    BANK_NAME_LABEL: "Nome do banco",
    BANK_LABEL: "Banco",
    RIF_LABEL: "RIF",
    paymentFallback: "Pagamento",
  },

  errors: {
    walletRejected:
      "A transação foi rejeitada na sua carteira. Aprove para continuar.",
    walletInsufficient:
      "Sua carteira não tem fundos suficientes para esta transação (incluindo gas).",
    revertUnknown:
      "A transação reverteu on-chain por um motivo não reconhecido. Tente de novo ou fale com o suporte.",
    revertNamedFallback:
      "A transação reverteu on-chain ({name}).",
    networkTimeout:
      "A rede está lenta. Tente de novo em um momento.",
    networkUnreachable:
      "Não foi possível alcançar a rede. Verifique sua conexão e tente de novo.",
    unknown: "Algo deu errado. Tente de novo.",

    noMerchants:
      "Nenhum merchant P2P elegível foi encontrado para esta transação.",
    missingRouting:
      "Este widget está sem a configuração necessária para achar um merchant. Contate o dono do site.",
    encryptionPreflight:
      "Não foi possível iniciar a mensageria segura. Recarregue a página — se continuar falhando, fale com o suporte.",
    encryptionFailed:
      "Não foi possível criptografar seus dados de pagamento. Tente de novo — se persistir, fale com o suporte.",
    orderBadStatus:
      "Este pedido já avançou e não pode ser tentado daqui. Atualize para ver o estado atual.",
    screeningApi:
      "A verificação antifraude está temporariamente indisponível. Seu pedido ainda pode seguir.",
    screeningRestricted:
      "Vimos atividade incomum — aguarde um pouco enquanto aplicamos uma atualização menor",
    screeningRejected:
      "Este pedido não pode ser processado. Fale com o suporte se achar que é um erro.",
    livenessRequired:
      "É necessária uma verificação rápida antes de continuar.",

    b2bProxyMismatch:
      "Esta rota de pagamento está mal configurada. Fale com o suporte — o endereço do integrador on-chain não bate com o registrado.",
    b2bIntegratorInactive:
      "Esta rota de pagamento está indisponível. Tente mais tarde — o integrador foi desativado on-chain.",
    b2bRejectedOrder:
      "O integrador do merchant rejeitou este pedido. Você pode ter atingido um limite por tx, por usuário ou diário.",
    b2bCallerNotContract:
      "A transação foi enviada de um endereço não suportado. Isso não deveria acontecer num checkout normal — reporte.",
    b2bProxyBadState:
      "O proxy on-chain está em mau estado. Fale com o suporte.",
    b2bProxyOwnerZero:
      "O proxy on-chain não está inicializado. Fale com o suporte.",
    b2bProxyImplLocked:
      "Este integrador foi registrado com outro template de proxy e não pode ser atualizado no lugar.",
    notEnoughMerchants:
      "Nenhum merchant P2P elegível foi encontrado para esta transação.",
    exchangeNotOperational:
      "O exchange P2P está temporariamente desativado. Tente mais tarde.",
    userBlacklisted:
      "Esta carteira está bloqueada para criar pedidos. Fale com o suporte se achar que é um erro.",
    zeroReputation:
      "Sua conta ainda não tem a reputação necessária para este pedido.",
    orderExpired: "Este pedido expirou. Comece um novo.",
    invalidAddress: "Um endereço on-chain foi rejeitado como inválido.",
    invalidAmount: "O valor do pedido foi rejeitado como inválido on-chain.",
    currencyNotSupported:
      "Esta moeda não é suportada on-chain no momento.",
    usdtTransferFailed:
      "A transferência USDC falhou — confirme saldo + allowance e tente de novo.",
    dailyBuyLimit: "Você atingiu o limite diário de compras. Tente amanhã.",
    monthlyBuyLimit:
      "Você atingiu o limite mensal de compras. Tente no próximo mês.",
    dailyPlacementLimit:
      "Você criou pedidos demais hoje. Tente mais tarde.",
    buyAmountLimit:
      "O valor de compra excede o limite por pedido do protocolo.",
    sellAmountLimit:
      "O valor de venda excede o limite por pedido do protocolo.",
    dailyVolume: "Você atingiu o limite de volume de hoje. Tente amanhã.",
    yearlyVolume: "Você atingiu o limite de volume deste ano.",
    upiAlreadySent:
      "Os dados de pagamento já foram enviados para este pedido.",
    invalidOrderUpi:
      "Seu endereço de pagamento não pôde ser aceito pelo protocolo.",
    orderAlreadyCancelled: "Este pedido já foi cancelado.",
  },
};
