export const SERVICE_TIME_ZONE = "America/Bogota";

export const STOP_STATUS = {
  BOARDED: "boarded",
  MISSED_BUS: "missed_bus",
};

export const STOP_STATUS_LABEL = {
  [STOP_STATUS.BOARDED]: "Asistio",
  [STOP_STATUS.MISSED_BUS]: "No asistio",
};

export const getServiceDateKey = (date = new Date()) => {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: SERVICE_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(date);
  } catch (error) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
};

const normalizeStopKeyPart = (value) =>
  value
    .toString()
    .trim()
    .toLowerCase()
    .replaceAll("/", "-")
    .replace(/\s+/g, " ");

export const normalizeStopKey = (stop) => {
  if (!stop) return "";
  const id = stop?.id === null || stop?.id === undefined ? "" : normalizeStopKeyPart(stop.id);
  if (id) return id;
  const address =
    stop?.address === null || stop?.address === undefined
      ? ""
      : normalizeStopKeyPart(stop.address);
  if (address) return address;
  const title =
    stop?.title === null || stop?.title === undefined ? "" : normalizeStopKeyPart(stop.title);
  return title;
};

export const isStopAbsentStatus = (statusValue) =>
  statusValue === STOP_STATUS.MISSED_BUS ||
  statusValue === "absent" ||
  statusValue === true;

export const createStopStatusMap = (docs) => {
  const mapped = {};
  docs.forEach((item) => {
    const data = item.data ? item.data() : item;
    const normalized = {
      id: data?.stopId || item.id,
      address: data?.stopAddress || data?.address || null,
      title: data?.stopTitle || data?.title || null,
    };
    const key = normalizeStopKey(normalized);
    if (!key) return;
    const payload = {
      id: item.id || data?.stopId || key,
      status: data?.status || null,
      justification: data?.justification || "",
      updatedAt: data?.updatedAt || null,
      monitorUid: data?.monitorUid || null,
      inasistencia:
        typeof data?.inasistencia === "boolean"
          ? data.inasistencia
          : isStopAbsentStatus(data?.status),
    };
    mapped[key] = payload;

    const addressKey = normalizeStopKey({ address: normalized.address });
    if (addressKey && !mapped[addressKey]) {
      mapped[addressKey] = payload;
    }

    const titleKey = normalizeStopKey({ title: normalized.title });
    if (titleKey && !mapped[titleKey]) {
      mapped[titleKey] = payload;
    }
  });
  return mapped;
};
