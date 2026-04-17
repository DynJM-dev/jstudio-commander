# Token Usage Analytics — JStudio Commander

Generated: 2026-04-17
Source: ~/.jstudio-commander/commander.db

---

## 1. Daily totals (last 14 days)

|    day     | sessions | in_tok | out_tok  | cache_read | cache_create | cost_usd |
|------------|----------|--------|----------|------------|--------------|----------|
| 2026-04-17 | 9        | 59030  | 10183332 | 2085640372 | 37623892     | 4598.54  |
| 2026-04-16 | 1        | 812    | 682296   | 234144609  | 9528498      | 581.06   |
| 2026-04-15 | 4        | 13537  | 3866483  | 1710840951 | 18994956     | 3212.61  |
| 2026-04-14 | 6        | 9680   | 568180   | 134544279  | 4207045      | 323.46   |

## 2. Per-model breakdown (last 14 days)

|      model      | events | in_tok | out_tok  | cache_read | cache_create | cost_usd |
|-----------------|--------|--------|----------|------------|--------------|----------|
| claude-opus-4-7 | 7922   | 58977  | 10188921 | 2058646343 | 35523510     | 4519.09  |
| claude-opus-4-6 | 5205   | 24082  | 5111370  | 2106523868 | 34830881     | 4196.58  |
| <synthetic>     | 6      | 0      | 0        | 0          | 0            | 0.0      |

## 3. PM vs Coder/Teammate split (last 14 days)

|      role      |      model      | in_tok | out_tok | cache_read | cost_usd |
|----------------|-----------------|--------|---------|------------|----------|
| PM             | claude-opus-4-7 | 12367  | 6185825 | 1004184312 | 2344.37  |
| coder/teammate | claude-opus-4-7 | 46484  | 3948040 | 1044432369 | 2148.94  |
| PM             | claude-opus-4-6 | 4001   | 2650945 | 1048399915 | 2107.04  |
| coder/teammate | claude-opus-4-6 | 3874   | 1712841 | 961898114  | 1796.45  |
| unclassified   | claude-opus-4-6 | 16207  | 747584  | 96225839   | 293.1    |
| unclassified   | claude-opus-4-7 | 144    | 64776   | 11885633   | 29.3     |
| PM             | <synthetic>     | 0      | 0       | 0          | 0.0      |
| coder/teammate | <synthetic>     | 0      | 0       | 0          | 0.0      |
| unclassified   | <synthetic>     | 0      | 0       | 0          | 0.0      |

## 4. Top 20 session spenders (all time, non-zero)

|              session_id              |   agent_role    |                      project_path                       | events | in_tok | out_tok | cache_read | cost_usd |
|--------------------------------------|-----------------|---------------------------------------------------------|--------|--------|---------|------------|----------|
| 447fe112-93e1-4ee2-a1d9-183b5fd26a46 | pm              | /Users/josemiguelbonilla/codeman-cases/JLFamily         | 2631   | 4337   | 2806923 | 1100792273 | 2206.46  |
| coder-9@jstudio-commander            | general-purpose | /Users/josemiguelbonilla/codeman-cases/JStudioCommand   | 2119   | 3874   | 1712841 | 961898114  | 1796.45  |
| 6073138e-507d-4adb-a253-cf7d1f9bea03 | lead-pm         | /Users/josemiguelbonilla/codeman-cases/JStudioCommand   | 2845   | 8331   | 3724605 | 732101037  | 1624.11  |
| coder-16@jstudio-commander           | general-purpose | /Users/josemiguelbonilla/codeman-cases/JStudioCommand   | 2206   | 27483  | 2097534 | 513522556  | 1076.71  |
| coder@jlp-patrimonio                 | general-purpose | /Users/josemiguelbonilla/codeman-cases/JLFamily         | 1722   | 19001  | 1850506 | 530909813  | 1072.24  |
| 03763f99-b77f-4628-907f-e1f13af3e73c | pm              | /Users/josemiguelbonilla/codeman-cases/JLFamily         | 632    | 2116   | 1124411 | 201632987  | 451.4    |
| 04bb12d7-01ac-43e0-a439-ea8278a76030 | pm              | /Users/josemiguelbonilla/Desktop/Projects/OvaGas-ERP    | 169    | 1584   | 1180831 | 18057930   | 169.44   |
| 000b81c5-8f9f-42c4-a6a8-c68306ea7b7f |                 | /Users/josemiguelbonilla/Desktop/Projects/elementti-ERP | 247    | 8879   | 210303  | 54588456   | 157.26   |
| 64b7805f-68a0-42bb-97d0-e2443a73f608 |                 | /Users/josemiguelbonilla/Desktop/Projects/OvaGas-ERP    | 159    | 264    | 230964  | 17943710   | 54.1     |
| e16a1cb2-8456-4341-aba6-168f7a6821d5 |                 |                                                         | 137    | 6584   | 134696  | 16723829   | 47.61    |
| 5482eb18-096c-4fdd-a6f9-7c2a4c6cf4bf |                 | /Users/josemiguelbonilla/Desktop/Projects/GrandGaming   | 139    | 207    | 164286  | 11043361   | 41.61    |
| 8e868853-89e8-4278-89fb-90f59e984377 |                 | /Users/josemiguelbonilla/Desktop/Projects/GrandGaming   | 35     | 51     | 27397   | 4735642    | 9.75     |
| 034d3e42-36e8-4dfb-b467-129cf6c589ca |                 | /Users/josemiguelbonilla/Desktop/Projects/GrandGaming   | 52     | 257    | 12801   | 1749421    | 4.83     |
| 6491b449-dd7a-464a-9634-26d81daaeda9 |                 | /Users/josemiguelbonilla/Desktop/Projects/GrandGaming   | 29     | 35     | 25757   | 882287     | 4.7      |
| 796eaede-2402-45fb-9763-22b0a2e052aa |                 |                                                         | 14     | 74     | 6156    | 444766     | 2.54     |

## 5. Cache efficiency (cache_read / (input + cache_read))

|    day     | input_uncached | cache_hits | cache_writes | cache_hit_pct | cost_usd |
|------------|----------------|------------|--------------|---------------|----------|
| 2026-04-17 | 59048          | 2087496343 | 37624504     | 100.0         | 4602.07  |
| 2026-04-16 | 812            | 234144609  | 9528498      | 100.0         | 581.06   |
| 2026-04-15 | 13537          | 1710840951 | 18994956     | 100.0         | 3212.61  |
| 2026-04-14 | 9680           | 134544279  | 4207045      | 100.0         | 323.46   |

## 6. Hourly cost distribution (last 48 hours)

|       hour       | in_tok | out_tok | cache_read | cost_usd |
|------------------|--------|---------|------------|----------|
| 2026-04-17 17:00 | 727    | 434706  | 75052918   | 162.61   |
| 2026-04-17 16:00 | 17077  | 416276  | 85038196   | 185.21   |
| 2026-04-17 15:00 | 6962   | 1279771 | 391497275  | 750.28   |
| 2026-04-17 14:00 | 445    | 275252  | 89136110   | 223.28   |
| 2026-04-17 13:00 | 16     | 3641    | 1986297    | 21.01    |
| 2026-04-17 12:00 | 388    | 151237  | 32639976   | 70.37    |
| 2026-04-17 11:00 | 993    | 409519  | 175320131  | 306.65   |
| 2026-04-17 10:00 | 8979   | 509320  | 99484051   | 255.91   |
| 2026-04-17 09:00 | 22     | 3947    | 2182252    | 5.76     |
| 2026-04-17 08:00 | 289    | 188500  | 52624024   | 99.4     |
| 2026-04-17 07:00 | 12094  | 931090  | 130965610  | 331.75   |
| 2026-04-17 06:00 | 2652   | 1656418 | 191286262  | 470.69   |
| 2026-04-17 05:00 | 1385   | 851736  | 172945397  | 351.6    |
| 2026-04-17 04:00 | 940    | 643815  | 132199396  | 301.31   |
| 2026-04-17 03:00 | 1582   | 818624  | 161359165  | 376.41   |
| 2026-04-17 02:00 | 1902   | 563811  | 111887127  | 241.73   |
| 2026-04-17 01:00 | 1085   | 584234  | 73570862   | 180.56   |
| 2026-04-17 00:00 | 1510   | 471155  | 108321294  | 267.54   |
| 2026-04-16 23:00 | 255    | 133980  | 42318395   | 127.75   |
| 2026-04-16 18:00 | 82     | 33686   | 39466497   | 63.0     |
| 2026-04-16 17:00 | 331    | 316312  | 110875828  | 269.93   |
| 2026-04-16 15:00 | 42     | 7665    | 7089263    | 11.54    |
| 2026-04-16 14:00 | 102    | 190653  | 34394626   | 108.84   |
| 2026-04-15 22:00 | 86     | 28512   | 19972623   | 33.07    |
| 2026-04-15 21:00 | 839    | 520095  | 194776184  | 387.58   |
| 2026-04-15 20:00 | 739    | 441588  | 325620174  | 567.98   |
| 2026-04-15 19:00 | 261    | 116143  | 64109246   | 121.47   |
| 2026-04-15 13:00 | 230    | 68481   | 39187980   | 148.07   |
| 2026-04-15 09:00 | 343    | 230206  | 76079380   | 139.0    |
| 2026-04-15 08:00 | 1933   | 1046889 | 281758602  | 530.53   |
| 2026-04-15 07:00 | 1609   | 857925  | 427385170  | 781.54   |
| 2026-04-15 06:00 | 7090   | 417864  | 188614702  | 328.67   |
| 2026-04-15 05:00 | 407    | 138780  | 93336890   | 174.69   |

## 7. Per-project cost (last 14 days)

|                         project                         | sessions | in_tok | out_tok | cache_read | cost_usd |
|---------------------------------------------------------|----------|--------|---------|------------|----------|
| /Users/josemiguelbonilla/codeman-cases/JStudioCommand   | 3        | 39688  | 7534980 | 2207521707 | 4497.27  |
| /Users/josemiguelbonilla/codeman-cases/JLFamily         | 3        | 25454  | 5781840 | 1833335073 | 3730.09  |
| /Users/josemiguelbonilla/Desktop/Projects/OvaGas-ERP    | 2        | 1848   | 1411795 | 36001640   | 223.54   |
| /Users/josemiguelbonilla/Desktop/Projects/elementti-ERP | 1        | 8879   | 210303  | 54588456   | 157.26   |
| /Users/josemiguelbonilla/Desktop/Projects/GrandGaming   | 4        | 550    | 230241  | 18410711   | 60.89    |
| [unknown]                                               | 2        | 6658   | 140852  | 17168595   | 50.14    |

## 8. cost_entries (daily rollup — alt source)

|    date    |      model      | in_tok | out_tok  | cache_read | cache_create | messages | cost_usd |
|------------|-----------------|--------|----------|------------|--------------|----------|----------|
| 2026-04-17 | claude-opus-4-7 | 72799  | 10119127 | 2042552102 | 35666972     | 7823     | 4492.61  |
| 2026-04-17 | claude-opus-4-6 | 238    | 101154   | 46406486   | 2470970      | 134      | 123.53   |
| 2026-04-17 | <synthetic>     | 0      | 0        | 0          | 0            | 4        | 0.0      |
| 2026-04-16 | claude-opus-4-6 | 627    | 575553   | 214732152  | 9157910      | 382      | 536.98   |
| 2026-04-16 | claude-opus-4-7 | 185    | 106743   | 19412457   | 370588       | 140      | 44.08    |
| 2026-04-16 | <synthetic>     | 0      | 0        | 0          | 0            | 1        | 0.0      |
| 2026-04-15 | claude-opus-4-6 | 13537  | 3866483  | 1710840951 | 18994956     | 4017     | 3212.61  |
| 2026-04-14 | claude-opus-4-6 | 10005  | 687460   | 178326903  | 4374268      | 797      | 401.22   |
| 2026-04-14 | <synthetic>     | 0      | 0        | 0          | 0            | 1        | 0.0      |

## 9. session_ticks (statusline-reported cost, last 14 days)

|    day     | sessions | sum_cost_reported | peak_session_cost | avg_5h_pct | peak_5h_pct |
|------------|----------|-------------------|-------------------|------------|-------------|
| 2026-04-17 | 9        | 672.57            | 229.76            | 72.7       | 88.0        |

## 10. Totals (all time + last 14d)

|  scope   | events | sessions | in_tok | out_tok  | cache_read | cost_usd |
|----------|--------|----------|--------|----------|------------|----------|
| all_time | 13136  | 15       | 83077  | 15310011 | 4167026182 | 8719.19  |
| last_14d | 13136  | 15       | 83077  | 15310011 | 4167026182 | 8719.19  |
