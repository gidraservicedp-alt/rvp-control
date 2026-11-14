# Actual cubic metres on every work result

Orders, the work queue, contractor cabinet and Telegram card now display entered `applications.actual_volume` prominently. The office can enter the actual volume at the top of the order or act review; the contractor supplies it with the service result. Tank capacity is never substituted for pumped volume.

Completion and act approval require a finite positive number below 1,000,000 m³, with at most three decimal places. Comma and decimal point are accepted in the input. Browser, Edge Function and PostgreSQL guards enforce the same rule; direct status writes and obsolete bot sessions cannot bypass it. Cancellation remains possible without a volume.

Office updates require an active owner, admin or dispatcher and the current application version. Changes are journaled. A submitted contractor result locks the volume until the act is returned for correction. Accepted volume flows unchanged into the application, object publication and monthly counter. Publication conflicts roll back the entire approval.

Existing closed applications are not reopened or assigned invented quantities. Historical rows with missing volume remain marked “Обсяг не вказано”; routine debt/payment metadata changes remain possible.

Validation: PGlite integration scenarios for missing/zero/negative/invalid quantities, direct writes, stale versions, role checks, exact decimal publication, duplicate approval, old no-volume drafts, conflicting publication rollback and legacy history; endpoint and Telegram tests; TypeScript, Deno and production build. Browser QA at 390×844 verified missing/zero volume blocks completion, then 12,345 m³ saves and completes with the same value. The screenshot contains synthetic fixture data only.

![Mobile volume entry on a test application](required-order-volume-mobile.jpg)
