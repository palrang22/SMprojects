import { Storage } from '@google-cloud/storage'

/**
 * GCS 헬퍼 — omni.ts(다운로드)와 tryon.ts(업로드+서명)가 공유한다.
 *
 * 서명 URL(getSignedUrl)은 signBlob 권한(roles/iam.serviceAccountTokenCreator,
 * 자기 자신 대상)이 있어야 동작한다. 로컬 dev 는 사용자 개인 ADC라 이 서명이
 * 안 될 수 있다 — 실패해도 던지지 않고 null 을 돌려줘서 호출부가 QR 없이
 * 계속 진행하게 한다. 실제 동작은 배포 후 서비스 계정으로 확인한다.
 */

const SIGNED_URL_TTL_MS = 60 * 60 * 1000 // 60분 — 부스 세션 길이 감안

export function parseGsUri(gsUri: string): { bucket: string; object: string } {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(gsUri)
  if (!match) throw new Error(`GCS URI 를 해석하지 못했습니다: ${gsUri}`)
  const [, bucket, object] = match
  return { bucket, object }
}

/** gs://bucket/path 를 로컬 파일로 내려받는다 (인증은 ADC 가 처리). */
export async function downloadFromGcs(
  gsUri: string,
  project: string,
  filePath: string,
): Promise<void> {
  const { bucket, object } = parseGsUri(gsUri)
  await new Storage({ projectId: project }).bucket(bucket).file(object).download({
    destination: filePath,
  })
}

/** 버퍼를 destGsUri(gs://bucket/path) 에 올린다. 실제로 쓰인 gs:// URI 를 돌려준다. */
export async function uploadBuffer(
  project: string,
  destGsUri: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const { bucket, object } = parseGsUri(destGsUri)
  await new Storage({ projectId: project })
    .bucket(bucket)
    .file(object)
    .save(buffer, { contentType })
  return destGsUri
}

/**
 * gsUri 에 대한 V4 서명 다운로드 URL을 만든다. IAP 를 거치지 않는
 * storage.googleapis.com 직행 링크라, 로그인 없는 부스 방문자도 열 수 있다.
 * signBlob 권한이 없으면(로컬 dev 등) 경고만 찍고 null.
 */
export async function createSignedUrl(
  project: string,
  gsUri: string,
  ttlMs: number = SIGNED_URL_TTL_MS,
): Promise<string | null> {
  try {
    const { bucket, object } = parseGsUri(gsUri)
    const [url] = await new Storage({ projectId: project })
      .bucket(bucket)
      .file(object)
      .getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + ttlMs })
    return url
  } catch (err) {
    console.warn(
      `[gcs] 서명 URL 생성 실패 (${gsUri}) — QR 다운로드 없이 계속합니다:`,
      err instanceof Error ? err.message : err,
    )
    return null
  }
}
