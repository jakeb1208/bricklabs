local HttpService = game:GetService("HttpService")

local bridgeRoot = "http://127.0.0.1:4317"
local sessionId = nil
local bridgeToken = nil
local busy = false

local toolbar = plugin:CreateToolbar("Studio Game Agent")
local openButton = toolbar:CreateButton(
	"Studio Game Agent",
	"Open the Roblox Studio game-building assistant",
	""
)
openButton.ClickableWhenViewportHidden = true

local widgetInfo = DockWidgetPluginGuiInfo.new(
	Enum.InitialDockState.Right,
	false,
	true,
	380,
	560,
	320,
	360
)
local widget = plugin:CreateDockWidgetPluginGuiAsync("StudioGameAgentWidget", widgetInfo)
widget.Title = "Studio Game Agent"

local root = Instance.new("Frame")
root.Name = "Root"
root.Size = UDim2.fromScale(1, 1)
root.BackgroundColor3 = Color3.fromRGB(25, 29, 38)
root.BorderSizePixel = 0
root.Parent = widget

local header = Instance.new("Frame")
header.Name = "Header"
header.Size = UDim2.new(1, 0, 0, 58)
header.BackgroundColor3 = Color3.fromRGB(32, 38, 50)
header.BorderSizePixel = 0
header.Parent = root

local title = Instance.new("TextLabel")
title.Name = "Title"
title.Position = UDim2.fromOffset(16, 7)
title.Size = UDim2.new(1, -32, 0, 24)
title.BackgroundTransparency = 1
title.Font = Enum.Font.SourceSansBold
title.Text = "Studio Game Agent"
title.TextColor3 = Color3.fromRGB(240, 244, 255)
title.TextSize = 19
title.TextXAlignment = Enum.TextXAlignment.Left
title.Parent = header

local status = Instance.new("TextLabel")
status.Name = "Status"
status.Position = UDim2.fromOffset(16, 31)
status.Size = UDim2.new(1, -32, 0, 18)
status.BackgroundTransparency = 1
status.Font = Enum.Font.SourceSans
status.Text = "Start the local bridge to connect"
status.TextColor3 = Color3.fromRGB(163, 177, 201)
status.TextSize = 13
status.TextXAlignment = Enum.TextXAlignment.Left
status.Parent = header

local chat = Instance.new("ScrollingFrame")
chat.Name = "Chat"
chat.Position = UDim2.fromOffset(0, 58)
chat.Size = UDim2.new(1, 0, 1, -132)
chat.BackgroundTransparency = 1
chat.BorderSizePixel = 0
chat.CanvasSize = UDim2.new()
chat.ScrollBarThickness = 6
chat.ScrollBarImageColor3 = Color3.fromRGB(93, 111, 141)
chat.AutomaticCanvasSize = Enum.AutomaticSize.Y
chat.Parent = root

local chatPadding = Instance.new("UIPadding")
chatPadding.PaddingTop = UDim.new(0, 12)
chatPadding.PaddingBottom = UDim.new(0, 12)
chatPadding.PaddingLeft = UDim.new(0, 12)
chatPadding.PaddingRight = UDim.new(0, 12)
chatPadding.Parent = chat

local chatLayout = Instance.new("UIListLayout")
chatLayout.Padding = UDim.new(0, 9)
chatLayout.SortOrder = Enum.SortOrder.LayoutOrder
chatLayout.Parent = chat

local composer = Instance.new("Frame")
composer.Name = "Composer"
composer.Position = UDim2.new(0, 0, 1, -74)
composer.Size = UDim2.new(1, 0, 0, 74)
composer.BackgroundColor3 = Color3.fromRGB(32, 38, 50)
composer.BorderSizePixel = 0
composer.Parent = root

local input = Instance.new("TextBox")
input.Name = "Message"
input.Position = UDim2.fromOffset(12, 12)
input.Size = UDim2.new(1, -92, 0, 50)
input.BackgroundColor3 = Color3.fromRGB(43, 51, 66)
input.BorderSizePixel = 0
input.ClearTextOnFocus = false
input.Font = Enum.Font.SourceSans
input.PlaceholderText = "Ask about your game or request a change…"
input.PlaceholderColor3 = Color3.fromRGB(151, 164, 186)
input.Text = ""
input.TextColor3 = Color3.fromRGB(240, 244, 255)
input.TextSize = 15
input.TextWrapped = true
input.TextXAlignment = Enum.TextXAlignment.Left
input.TextYAlignment = Enum.TextYAlignment.Center
input.Parent = composer

local inputCorner = Instance.new("UICorner")
inputCorner.CornerRadius = UDim.new(0, 8)
inputCorner.Parent = input

local send = Instance.new("TextButton")
send.Name = "Send"
send.Position = UDim2.new(1, -72, 0, 12)
send.Size = UDim2.fromOffset(60, 50)
send.BackgroundColor3 = Color3.fromRGB(94, 121, 255)
send.BorderSizePixel = 0
send.Font = Enum.Font.SourceSansBold
send.Text = "Send"
send.TextColor3 = Color3.fromRGB(255, 255, 255)
send.TextSize = 15
send.Parent = composer

local sendCorner = Instance.new("UICorner")
sendCorner.CornerRadius = UDim.new(0, 8)
sendCorner.Parent = send

local function round(parent, radius)
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, radius)
	corner.Parent = parent
	return corner
end

local function addMessage(role, text)
	local isUser = role == "You"
	local message = Instance.new("TextLabel")
	message.Name = "Message"
	message.AutomaticSize = Enum.AutomaticSize.Y
	message.Size = UDim2.new(1, -12, 0, 0)
	message.BackgroundColor3 = isUser and Color3.fromRGB(54, 72, 128) or Color3.fromRGB(37, 44, 58)
	message.BorderSizePixel = 0
	message.Font = Enum.Font.SourceSans
	message.Text = role .. "\n" .. text
	message.TextColor3 = Color3.fromRGB(233, 238, 249)
	message.TextSize = 15
	message.TextWrapped = true
	message.TextXAlignment = Enum.TextXAlignment.Left
	message.TextYAlignment = Enum.TextYAlignment.Top
	message.LayoutOrder = #chat:GetChildren()
	message.Parent = chat

	local padding = Instance.new("UIPadding")
	padding.PaddingTop = UDim.new(0, 9)
	padding.PaddingBottom = UDim.new(0, 9)
	padding.PaddingLeft = UDim.new(0, 11)
	padding.PaddingRight = UDim.new(0, 11)
	padding.Parent = message
	round(message, 8)

	task.defer(function()
		chat.CanvasPosition = Vector2.new(0, math.max(0, chat.AbsoluteCanvasSize.Y))
	end)
	return message
end

local function requestJson(path, method, payload)
	local headers = {
		["Content-Type"] = "application/json",
	}
	if bridgeToken then
		headers["Authorization"] = "Bearer " .. bridgeToken
	end

	local options = {
		Url = bridgeRoot .. path,
		Method = method,
		Headers = headers,
	}
	if payload then
		options.Body = HttpService:JSONEncode(payload)
	end

	local ok, result = pcall(function()
		return HttpService:RequestAsync(options)
	end)
	if not ok then
		return nil, "Could not reach the local bridge. Start it and allow Studio to contact 127.0.0.1."
	end
	if not result.Success then
		local detail = result.Body
		local parsed, decoded = pcall(function()
			return HttpService:JSONDecode(result.Body)
		end)
		if parsed and type(decoded) == "table" and decoded.error then
			detail = decoded.error
		end
		return nil, tostring(detail)
	end

	local parsed, decoded = pcall(function()
		return HttpService:JSONDecode(result.Body)
	end)
	if not parsed then
		return nil, "The local bridge returned invalid JSON."
	end
	return decoded, nil
end

local function updateStatus()
	task.spawn(function()
		local config, configError = requestJson("/api/bridge-config", "GET")
		if not config then
			status.Text = "Bridge offline — start the local bridge"
			status.TextColor3 = Color3.fromRGB(242, 161, 116)
			return
		end

		bridgeToken = config.bridgeToken
		if type(config.apiBaseUrl) == "string"
			and config.apiBaseUrl:match("^http://127%.0%.0%.1:%d+$")
		then
			bridgeRoot = config.apiBaseUrl
		end
		local health, healthError = requestJson("/healthz", "GET")
		if not health then
			status.Text = "Bridge error — " .. tostring(healthError or configError)
			status.TextColor3 = Color3.fromRGB(242, 161, 116)
		elseif health.mcpConnected then
			status.Text = "Connected to Roblox Studio · " .. tostring(health.toolCount) .. " tools"
			status.TextColor3 = Color3.fromRGB(124, 218, 169)
		else
			status.Text = "Bridge running — enable Studio MCP and restart the bridge"
			status.TextColor3 = Color3.fromRGB(242, 190, 116)
		end
	end)
end

local function setBusy(value)
	busy = value
	send.Active = not value
	send.AutoButtonColor = not value
	send.Text = value and "…" or "Send"
	input.TextEditable = not value
end

local function renderApproval(response)
	local calls = response.toolCalls or {}
	local details = {}
	for _, call in ipairs(calls) do
		local arguments = HttpService:JSONEncode(call.arguments or {})
		if #arguments > 360 then
			arguments = string.sub(arguments, 1, 360) .. "…"
		end
		table.insert(details, tostring(call.name) .. "\n" .. arguments)
	end
	local bodyText = "Review before this runs:\n" .. table.concat(details, "\n\n")
	local card = addMessage("Review action", bodyText)
	card.TextColor3 = Color3.fromRGB(255, 221, 160)

	local actionFrame = Instance.new("Frame")
	actionFrame.Name = "ApprovalActions"
	actionFrame.Size = UDim2.new(1, -12, 0, 39)
	actionFrame.BackgroundTransparency = 1
	actionFrame.LayoutOrder = #chat:GetChildren()
	actionFrame.Parent = chat

	local deny = Instance.new("TextButton")
	deny.Name = "Deny"
	deny.Size = UDim2.new(0.5, -5, 1, 0)
	deny.BackgroundColor3 = Color3.fromRGB(65, 73, 89)
	deny.BorderSizePixel = 0
	deny.Font = Enum.Font.SourceSansBold
	deny.Text = "Deny"
	deny.TextColor3 = Color3.fromRGB(235, 239, 247)
	deny.TextSize = 15
	deny.Parent = actionFrame
	round(deny, 7)

	local approve = Instance.new("TextButton")
	approve.Name = "Approve"
	approve.Position = UDim2.new(0.5, 5, 0, 0)
	approve.Size = UDim2.new(0.5, -5, 1, 0)
	approve.BackgroundColor3 = Color3.fromRGB(94, 121, 255)
	approve.BorderSizePixel = 0
	approve.Font = Enum.Font.SourceSansBold
	approve.Text = "Approve"
	approve.TextColor3 = Color3.fromRGB(255, 255, 255)
	approve.TextSize = 15
	approve.Parent = actionFrame
	round(approve, 7)

	local function answerApproval(approved)
		setBusy(true)
		deny.Active = false
		approve.Active = false
		status.Text = approved and "Applying approved Studio action…" or "Declining Studio action…"

		task.spawn(function()
			local result, err = requestJson("/api/approve", "POST", {
				pendingId = response.pendingId,
				approved = approved,
			})
			if not result then
				addMessage("Agent", "Action response failed: " .. tostring(err))
				setBusy(false)
				updateStatus()
				return
			end

			if result.needsApproval then
				sessionId = result.sessionId or sessionId
				renderApproval(result)
			else
				addMessage("Agent", result.answer or "Done.")
				setBusy(false)
				updateStatus()
			end
		end)
	end

	deny.Activated:Connect(function()
		answerApproval(false)
	end)
	approve.Activated:Connect(function()
		answerApproval(true)
	end)
end

local function renderResponse(response)
	sessionId = response.sessionId or sessionId
	if response.needsApproval then
		renderApproval(response)
	else
		addMessage("Agent", response.answer or "I wasn't able to produce a response.")
		setBusy(false)
		updateStatus()
	end
end

local function sendMessage()
	if busy then
		return
	end
	local text = input.Text:gsub("^%s+", ""):gsub("%s+$", "")
	if text == "" then
		return
	end

	input.Text = ""
	addMessage("You", text)
	setBusy(true)
	status.Text = "Thinking and checking your open Studio project…"
	status.TextColor3 = Color3.fromRGB(163, 177, 201)

	task.spawn(function()
		local response, err = requestJson("/api/chat", "POST", {
			message = text,
			sessionId = sessionId,
		})
		if not response then
			addMessage("Agent", tostring(err))
			setBusy(false)
			updateStatus()
			return
		end
		renderResponse(response)
	end)
end

send.Activated:Connect(sendMessage)
input.FocusLost:Connect(function(enterPressed)
	if enterPressed then
		sendMessage()
	end
end)

openButton.Click:Connect(function()
	widget.Enabled = not widget.Enabled
	if widget.Enabled then
		updateStatus()
	end
end)

addMessage(
	"Agent",
	"Tell me what you want to build. I can inspect the open place, write Luau, and help test it. Studio-changing actions always wait for your approval."
)
updateStatus()
