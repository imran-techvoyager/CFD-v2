let lastStreamId = "$"; // default to only new messages

export function setLastStreamId(id: string) {
  lastStreamId = id;
}

export function getLastStreamId() {
  return lastStreamId;
}
