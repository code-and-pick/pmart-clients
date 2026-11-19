// 정본 서비스가 돌려준 승인 요청 본문을 approval-service 에 올린다(변경 요청 생성 → 제출).
import { Link } from 'react-router';

import { requestApproval, type ApprovalRequested } from '../../api/approvalFlow';
import type { ApprovalRequestBody } from '../../api/models';
import { useApi } from '../../app/ApiContext';
import { CommandFeedback } from '../../shared/Feedback';
import { hideIds } from '../../shared/hideIds';
import { messages as m } from '../../shared/messages';
import { useCommand } from '@pmart/web-ui';
import { CodeLabel } from '../../shared/admin';

/** 승인 유형 이름 — 코드는 마우스를 올리면(2026-11-18 "직관적이지 않다") */
const TYPE_NAME: Readonly<Record<string, string>> = { ...m.approvals.typeName, ...m.approvals.otherTypeName };

export function RequestApproval({
  body,
  onRequested,
}: {
  readonly body: ApprovalRequestBody;
  readonly onRequested?: (r: ApprovalRequested) => void;
}) {
  const api = useApi();
  const cmd = useCommand(async (b: ApprovalRequestBody, key) => {
    const r = await requestApproval(api, b, key);
    onRequested?.(r);
    return r;
  });
  const done = cmd.phase.kind === 'done';

  return (
    <div className="space-y-2 rounded-box border border-base-300 p-3">
      <p className="text-sm">
        <CodeLabel code={body.type} names={TYPE_NAME} />
        {` · ${hideIds(body.summary)}`}
      </p>
      {!done && (
        <button type="button" className="btn btn-primary btn-sm" disabled={cmd.busy} onClick={() => void cmd.run(body)}>
          {m.approvals.requestApproval}
        </button>
      )}
      <CommandFeedback command={cmd}>
        {(r) =>
          r.approvalId ? (
            <div role="status" className="alert alert-success alert-soft">
              <span>{m.approvals.requested}</span>
              <Link className="link" to={`/approvals/${encodeURIComponent(r.approvalId)}`}>
                {m.approvals.open}
              </Link>
            </div>
          ) : (
            <div role="status" className="alert alert-info alert-soft">
              {m.approvals.requestedNoId}
            </div>
          )
        }
      </CommandFeedback>
    </div>
  );
}
