// 调试 usage 显示问题的脚本
const API_KEY = 'your-secure-api-key-123';
const BASE_URL = 'http://127.0.0.1:3456';

async function debugPoolStatus() {
    console.log('=== 开始调试 Pool Status ===\n');

    try {
        const response = await fetch(`${BASE_URL}/api/pool/status`, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        console.log('1. 原始数据结构:');
        console.log(JSON.stringify(data, null, 2));

        console.log('\n2. 检查每个账户的 usage 数据:');
        data.accounts.forEach((account, index) => {
            console.log(`\n账户 ${index + 1}: ${account.name} (${account.id})`);
            console.log('  - usage 对象:', account.usage);
            console.log('  - usagePercent 类型:', typeof account.usage.usagePercent);
            console.log('  - usagePercent 值:', account.usage.usagePercent);
            console.log('  - last5Hours:', account.usage.last5Hours);
            console.log('  - last5HoursLimit:', account.usage.last5HoursLimit);
            console.log('  - weekly:', account.usage.weekly);
            console.log('  - weeklyLimit:', account.usage.weeklyLimit);

            // 测试 formatPercent 函数
            const formatPercent = (percent) => {
                if (typeof percent !== 'number' || isNaN(percent)) {
                    console.error(`    ❌ formatPercent 失败: 无效的 percent 值`, percent);
                    return 'N/A';
                }
                const result = percent.toFixed(1) + '%';
                console.log(`    ✅ formatPercent 结果: ${result}`);
                return result;
            };

            // 测试 5h usage
            const usage5hPercent = account.usage.usagePercent;
            console.log(`  - 5h Usage 百分比计算: ${usage5hPercent}%`);
            const formatted5h = formatPercent(usage5hPercent);

            // 测试 weekly usage
            const weeklyPercent = account.usage.weeklyLimit > 0
                ? (account.usage.weekly / account.usage.weeklyLimit) * 100
                : 0;
            console.log(`  - Weekly Usage 百分比计算: ${weeklyPercent}%`);
            const formattedWeekly = formatPercent(weeklyPercent);

            // 测试颜色函数
            const getUsageColor = (percent) => {
                if (percent < 50) return 'green';
                if (percent < 80) return 'yellow';
                return 'red';
            };

            console.log(`  - 5h Usage 颜色: ${getUsageColor(usage5hPercent)}`);
            console.log(`  - Weekly Usage 颜色: ${getUsageColor(weeklyPercent)}`);
        });

        console.log('\n3. 模拟前端渲染:');
        console.log('表格列: Name | Status | Concurrency | Usage (5h) | Usage (Weekly) | Bound Sessions | Last Used');
        console.log('-'.repeat(120));

        data.accounts.forEach(account => {
            const usage5hPercent = account.usage.usagePercent;
            const weeklyPercent = account.usage.weeklyLimit > 0
                ? (account.usage.weekly / account.usage.weeklyLimit) * 100
                : 0;

            const formatPercent = (percent) => {
                if (typeof percent !== 'number' || isNaN(percent)) {
                    return 'N/A';
                }
                return percent.toFixed(1) + '%';
            };

            const row = [
                account.name.substring(0, 15),
                account.status,
                `${account.concurrency.current}/${account.concurrency.max}`,
                formatPercent(usage5hPercent),
                formatPercent(weeklyPercent),
                account.boundSessions.toString(),
                account.lastUsedAt ? account.lastUsedAt.substring(0, 19) : '-'
            ].join(' | ');

            console.log(row);
        });

        console.log('\n=== 调试完成 ===');
        console.log('\n如果您在浏览器中看不到 usage 数据，请检查:');
        console.log('1. 浏览器控制台是否有 JavaScript 错误');
        console.log('2. 网络请求是否成功返回数据');
        console.log('3. 数据是否被正确渲染到 DOM');
        console.log('4. CSS 样式是否隐藏了某些元素');

    } catch (error) {
        console.error('调试失败:', error);
    }
}

debugPoolStatus();
